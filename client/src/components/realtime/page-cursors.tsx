"use client";

// Live cursor overlay for a page. Publishes local mouse position
// (normalised 0..1 against the anchor element) to peers and renders
// remote cursors as coloured pointer + name chip.
//
// Desktop only — the anchor's `pointer-events-none` overlay is skipped
// on touch pointers so mobile users just see the avatar stack.

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { usePagePresence } from "@/lib/realtime/use-page-presence";
import type { CollabPeer, RemoteCursor } from "@/lib/realtime/use-page-presence";
import { cn } from "@/lib/utils";

interface Props {
  pageId: string;
  /** The element cursors are positioned relative to. On a typical
   *  detail page, wrap the main content in a `<div ref={anchorRef}
   *  className="relative">…</div>` and pass the ref here. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Skip publishing local cursor (still shows peers). Useful when a
   *  form's own cursor overlay already covers the same area. */
  publishLocal?: boolean;
  disabled?: boolean;
}

export function PageCursors({
  pageId,
  anchorRef,
  publishLocal = true,
  disabled = false,
}: Props) {
  const { cursors, setCursor, hideCursor } = usePagePresence({
    pageId,
    disabled,
  });

  const [anchorSize, setAnchorSize] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });

  // Watch the anchor's size so we can un-normalise incoming cursor
  // fractions into absolute pixels on-render.
  useEffect(() => {
    const el = anchorRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setAnchorSize({ w: rect.width, h: rect.height });
    });
    observer.observe(el);
    const rect = el.getBoundingClientRect();
    setAnchorSize({ w: rect.width, h: rect.height });
    return () => observer.disconnect();
  }, [anchorRef]);

  // Publish local cursor. Skip on touch pointers — mobile users don't
  // send cursors (avatar-only per product spec).
  useEffect(() => {
    if (disabled || !publishLocal) return;
    const el = anchorRef.current;
    if (!el) return;

    const isTouch =
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: coarse)").matches;
    if (isTouch) return;

    const emit = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      setCursor(x, y);
    };
    const leave = () => hideCursor();

    el.addEventListener("mousemove", emit);
    el.addEventListener("mouseleave", leave);
    window.addEventListener("blur", leave);

    return () => {
      el.removeEventListener("mousemove", emit);
      el.removeEventListener("mouseleave", leave);
      window.removeEventListener("blur", leave);
      hideCursor();
    };
  }, [anchorRef, publishLocal, disabled, setCursor, hideCursor]);

  if (disabled || cursors.length === 0 || anchorSize.w === 0) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-30 overflow-hidden"
    >
      {cursors.map((c) => (
        <RemoteCursorPointer
          key={c.peer.id}
          cursor={c}
          size={anchorSize}
        />
      ))}
    </div>
  );
}

const CURSOR_PALETTE = [
  "#f97316", // orange
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#f43f5e", // rose
  "#10b981", // emerald
  "#eab308", // amber
  "#3b82f6", // blue
  "#ec4899", // pink
];

function colourFor(peer: CollabPeer): string {
  const seed = Number(peer.id);
  return CURSOR_PALETTE[seed % CURSOR_PALETTE.length];
}

function RemoteCursorPointer({
  cursor,
  size,
}: {
  cursor: RemoteCursor;
  size: { w: number; h: number };
}) {
  const lastPosRef = useRef({ x: cursor.x * size.w, y: cursor.y * size.h });
  const posRef = useRef(lastPosRef.current);
  const domRef = useRef<HTMLDivElement | null>(null);
  const [colour] = useState(() => colourFor(cursor.peer));

  useEffect(() => {
    posRef.current = { x: cursor.x * size.w, y: cursor.y * size.h };
  }, [cursor.x, cursor.y, size.w, size.h]);

  // rAF-driven interpolation from the last known position toward the
  // latest — smooths out the 30fps network stream into 60fps visual.
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
      style={{ transform: `translate3d(${lastPosRef.current.x}px, ${lastPosRef.current.y}px, 0)` }}
    >
      {/* SVG pointer arrow */}
      <svg
        width="14"
        height="18"
        viewBox="0 0 14 18"
        className="drop-shadow-sm"
        aria-hidden
      >
        <path
          d="M0 0 L0 14 L4 10 L7 17 L9 16 L6 9 L11 8 Z"
          fill={colour}
          stroke="white"
          strokeWidth="1"
        />
      </svg>
      <span
        className={cn(
          "absolute left-3 top-4 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm",
        )}
        style={{ backgroundColor: colour }}
      >
        {cursor.peer.name}
      </span>
    </div>
  );
}
