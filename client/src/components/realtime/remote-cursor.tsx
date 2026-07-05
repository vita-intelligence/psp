"use client";

import { peerColor } from "@/lib/peer-color";
import type { RemoteCursor as RemoteCursorData } from "@/lib/realtime/use-live-form";

interface RemoteCursorProps {
  cursor: RemoteCursorData;
  /** Width of the anchor element the normalized coordinates are
   *  relative to. Re-rendered when the anchor's bounding box changes
   *  (resize, scroll, etc.). */
  anchorWidth: number;
  anchorHeight: number;
}

/**
 * Renders a single peer's mouse cursor inside the anchor element.
 * Position is computed from the peer's normalized 0..1 coordinates
 * times the anchor's current dimensions, so the same fraction lands
 * at the same visual spot regardless of the receiver's screen size.
 *
 * CSS `transition` smooths between the 50ms broadcast intervals so
 * the motion looks continuous rather than steppy. `pointer-events:
 * none` makes sure the cursor itself never blocks interaction with
 * the form underneath.
 */
export function RemoteCursor({
  cursor,
  anchorWidth,
  anchorHeight,
}: RemoteCursorProps) {
  // Prefer the immutable peer id (numeric user id) as the color seed —
  // email is no longer broadcast in presence, so falling back to it
  // gives everyone the same slot.
  const color = peerColor(cursor.peer.id || cursor.peer.email);
  const x = Math.max(0, Math.min(1, cursor.x)) * anchorWidth;
  const y = Math.max(0, Math.min(1, cursor.y)) * anchorHeight;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-0 left-0 z-30"
      style={{
        transform: `translate(${x}px, ${y}px)`,
        transition: "transform 80ms linear",
      }}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.25))" }}
      >
        <path
          d="M3 2.5l6.5 18 2.5-7L19.5 11 3 2.5z"
          fill={color}
          stroke="white"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className="ml-3 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-medium text-white shadow-sm"
        style={{
          backgroundColor: color,
          transform: "translateY(-2px)",
        }}
      >
        {cursor.peer.name}
      </span>
    </div>
  );
}
