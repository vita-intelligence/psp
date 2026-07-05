"use client";

// Content-anchored cursor overlay. Sits as a fixed `pointer-events-none`
// layer above the app body so remote cursors are visible on EVERY route
// — home, lists, ledgers, wizards, forms.
//
// Two users on different resolutions used to see cursors at
// mismatched CONTENT positions because we normalised against the
// viewport. Now we anchor cursor coordinates to a shared, max-width-
// constrained CONTENT element. Since every page in this app centers
// its content in a `mx-auto max-w-Nxl` wrapper, both users get an
// anchor of the same pixel width (when their viewport exceeds the
// max-w — always on desktop). Cursor fraction → same pixel offset
// into the content on both sides → same element highlighted.
//
// Anchor discovery:
//   1. Explicit `[data-cursor-anchor]` attribute (opt-in per page)
//   2. First `mx-auto` descendant of the first <main> (matches
//      99% of pages in this codebase — the PageHeader / RecordHero /
//      LotHeader all live inside such a wrapper)
//   3. <main> itself (still resolution-dependent, but at least the
//      vertical scroll math stays honest)
//   4. `document.documentElement` fallback

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { usePagePresence } from "@/lib/realtime/use-page-presence";
import type {
  CollabPeer,
  RemoteCursor,
} from "@/lib/realtime/use-page-presence";

const DISABLED_PREFIXES = ["/login", "/logout", "/auth"];

function findAnchor(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const explicit = document.querySelector<HTMLElement>("[data-cursor-anchor]");
  if (explicit) return explicit;
  const main = document.querySelector("main");
  if (main) {
    const constrained = main.querySelector<HTMLElement>('div[class*="max-w-"]');
    if (constrained) return constrained;
    return main as HTMLElement;
  }
  return document.documentElement;
}

export function GlobalPageCursors() {
  const pathname = usePathname();
  const disabled =
    !pathname ||
    DISABLED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const pageId = pathname ?? "";
  const { cursors, setCursor, hideCursor } = usePagePresence({
    pageId,
    disabled,
  });

  useEffect(() => {
    if (disabled) return;

    const isTouch =
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: coarse)").matches;
    if (isTouch) return;

    const emit = (e: MouseEvent) => {
      const anchor = findAnchor();
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      // Emit as a normalised FRACTION of the anchor's own width/height.
      // Same content → same rect.width on both users' anchors, so the
      // fraction lands on the same content element.
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      if (x < -0.05 || x > 1.05 || y < -0.5 || y > 1.5) return;
      setCursor(x, y);
    };

    const leave = () => hideCursor();

    window.addEventListener("mousemove", emit);
    window.addEventListener("mouseout", (e) => {
      if (!e.relatedTarget && !(e as MouseEvent & { toElement?: unknown }).toElement) {
        leave();
      }
    });
    window.addEventListener("blur", leave);

    return () => {
      window.removeEventListener("mousemove", emit);
      window.removeEventListener("blur", leave);
      hideCursor();
    };
  }, [disabled, setCursor, hideCursor]);

  if (disabled || cursors.length === 0) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[9999]"
    >
      {cursors.map((c) => (
        <ViewportCursorPointer key={c.peer.id} cursor={c} />
      ))}
    </div>
  );
}

const CURSOR_PALETTE = [
  "#f97316",
  "#8b5cf6",
  "#06b6d4",
  "#f43f5e",
  "#10b981",
  "#eab308",
  "#3b82f6",
  "#ec4899",
];

function colourFor(peer: CollabPeer): string {
  const seed = Number(peer.id);
  return CURSOR_PALETTE[seed % CURSOR_PALETTE.length];
}

function ViewportCursorPointer({ cursor }: { cursor: RemoteCursor }) {
  const domRef = useRef<HTMLDivElement | null>(null);
  const posRef = useRef({ x: 0, y: 0 });
  const lastPosRef = useRef({ x: 0, y: 0 });
  const colourRef = useRef(colourFor(cursor.peer));
  // Track anchor rect so we can re-derive absolute cursor position
  // when the receiver scrolls (rect.top moves with scroll) or resizes.
  const [anchorRect, setAnchorRect] = useState<{ left: number; top: number; width: number; height: number }>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });

  useEffect(() => {
    const measure = () => {
      const el = findAnchor();
      if (!el) return;
      const r = el.getBoundingClientRect();
      setAnchorRect({ left: r.left, top: r.top, width: r.width, height: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    const el = findAnchor();
    if (el) ro.observe(el);
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    posRef.current = {
      x: anchorRect.left + cursor.x * anchorRect.width,
      y: anchorRect.top + cursor.y * anchorRect.height,
    };
  }, [cursor.x, cursor.y, anchorRect]);

  useEffect(() => {
    let raf: number;
    const tick = () => {
      const el = domRef.current;
      if (!el) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const dx = posRef.current.x - lastPosRef.current.x;
      const dy = posRef.current.y - lastPosRef.current.y;
      lastPosRef.current = {
        x: lastPosRef.current.x + dx * 0.35,
        y: lastPosRef.current.y + dy * 0.35,
      };
      el.style.transform = `translate3d(${lastPosRef.current.x}px, ${lastPosRef.current.y}px, 0)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      ref={domRef}
      className="absolute left-0 top-0 will-change-transform"
      style={{ transform: `translate3d(0px, 0px, 0)` }}
    >
      <svg
        width="14"
        height="18"
        viewBox="0 0 14 18"
        className="drop-shadow-sm"
        aria-hidden
      >
        <path
          d="M0 0 L0 14 L4 10 L7 17 L9 16 L6 9 L11 8 Z"
          fill={colourRef.current}
          stroke="white"
          strokeWidth="1"
        />
      </svg>
      <span
        className="absolute left-3 top-4 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm"
        style={{ backgroundColor: colourRef.current }}
      >
        {cursor.peer.name}
      </span>
    </div>
  );
}
