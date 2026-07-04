"use client";

// Viewport-anchored cursor overlay. Sits as a fixed `pointer-events-none`
// layer above the app body so remote cursors are visible on EVERY route
// — home, lists, ledgers, wizards, forms — not just detail pages that
// carry an explicit <PageCursorAnchor>.
//
// The anchor is the viewport itself: emits use clientX / clientY
// normalised against window.innerWidth / innerHeight, and remote
// cursors are positioned in fixed screen coords.
//
// Detail pages that ALSO mount a per-page <PageCursors> pass
// `publishLocal={false}` there, since this global publisher owns the
// stream. The overlay renders in both places (twice-rendered cursors
// coalesce because they share the same store state).

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { usePagePresence } from "@/lib/realtime/use-page-presence";
import type {
  CollabPeer,
  RemoteCursor,
} from "@/lib/realtime/use-page-presence";

const DISABLED_PREFIXES = ["/login", "/logout", "/auth"];

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

  // Publish local cursor against the viewport. Skip on touch pointers.
  useEffect(() => {
    if (disabled) return;

    const isTouch =
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: coarse)").matches;
    if (isTouch) return;

    const emit = (e: MouseEvent) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (w === 0 || h === 0) return;
      const x = e.clientX / w;
      const y = e.clientY / h;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      setCursor(x, y);
    };

    const leave = () => hideCursor();

    window.addEventListener("mousemove", emit);
    window.addEventListener("mouseout", (e) => {
      // Only hide when the mouse actually leaves the browser window,
      // not on child-element transitions.
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

  useEffect(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    posRef.current = { x: cursor.x * w, y: cursor.y * h };
  }, [cursor.x, cursor.y]);

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
