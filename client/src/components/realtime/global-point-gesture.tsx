"use client";

// "Point at this element" gesture. Alt+click any element that has a
// `data-collab-id` (or a descendant of one) and every peer on the same
// page sees a coloured pulse ring on the matching element on their
// side — regardless of whether it moved due to responsive-grid
// reflow. Fixes the "look here" ambiguity that plain cursors can't
// solve when the same content lays out differently at different
// resolutions.
//
// Sender:  Alt+click → point:element broadcast with the nearest
//          data-collab-id in the ancestor chain.
// Receiver: watch inbound bursts, find the matching DOM node, add a
//          brief pulse ring, then drop the burst.
//
// The Alt key is a soft modifier — doesn't fight normal clicks. On
// macOS it doubles as ⌥; on Windows it's Alt. If the user Alt+clicks
// an element with no data-collab-id in its ancestor chain, we
// silently no-op instead of spamming.

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { usePagePresence } from "@/lib/realtime/use-page-presence";
import type { CollabPeer } from "@/lib/realtime/use-page-presence";

const DISABLED_PREFIXES = ["/login", "/logout", "/auth"];

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

export function GlobalPointGesture() {
  const pathname = usePathname();
  const disabled =
    !pathname ||
    DISABLED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const pageId = pathname ?? "";
  const { point, pointBursts, clearPointBurst, peers } = usePagePresence({
    pageId,
    disabled,
  });

  // Sender — listen for Alt+click at the document level.
  useEffect(() => {
    if (disabled) return;

    const onClick = (e: MouseEvent) => {
      if (!e.altKey) return;
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(
        "[data-collab-id]",
      );
      if (!el) return;
      const collabId = el.getAttribute("data-collab-id");
      if (!collabId) return;
      point(collabId);
      // Also give the sender a local pulse so they see confirmation
      // that the gesture landed.
      pulse(el, "#3b82f6");
      // Don't preventDefault — the click can still activate a link
      // or button if the Alt modifier isn't otherwise consumed.
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [disabled, point]);

  // Receiver — pulse the matching element on every inbound burst,
  // then acknowledge so we don't re-fire.
  useEffect(() => {
    if (disabled || pointBursts.length === 0) return;
    for (const burst of pointBursts) {
      const el = document.querySelector<HTMLElement>(
        `[data-collab-id="${cssEscape(burst.collabId)}"]`,
      );
      const peer = peers.find((p) => p.id === burst.peerId);
      const colour = peer ? colourFor(peer) : "#3b82f6";
      if (el) pulse(el, colour, peer?.name);
      clearPointBurst(burst.at);
    }
  }, [pointBursts, peers, disabled, clearPointBurst]);

  return null;
}

// One-shot pulse — outline + label chip that fade out over 1.4s. No
// state kept; we rely on Web Animations API to run + garbage-collect
// the animation.
function pulse(el: HTMLElement, colour: string, byName?: string) {
  // Ring effect via a synthesised overlay div so we don't disturb the
  // target's own outline / box-shadow.
  const rect = el.getBoundingClientRect();
  const overlay = document.createElement("div");
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.position = "fixed";
  overlay.style.left = `${rect.left}px`;
  overlay.style.top = `${rect.top}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
  overlay.style.borderRadius = getComputedStyle(el).borderRadius || "6px";
  overlay.style.boxShadow = `0 0 0 3px ${colour}, 0 0 0 6px ${colour}33`;
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "9998";
  overlay.style.transition = "opacity 200ms ease-out";

  if (byName) {
    const chip = document.createElement("div");
    chip.textContent = byName;
    chip.style.position = "absolute";
    chip.style.left = "0";
    chip.style.top = "-1.4rem";
    chip.style.padding = "2px 6px";
    chip.style.borderRadius = "9999px";
    chip.style.background = colour;
    chip.style.color = "white";
    chip.style.fontSize = "10px";
    chip.style.fontWeight = "500";
    chip.style.whiteSpace = "nowrap";
    chip.style.boxShadow = "0 1px 2px rgba(0,0,0,0.15)";
    overlay.appendChild(chip);
  }

  document.body.appendChild(overlay);

  // Scroll the target into view for the receiver so they don't hunt
  // for a pulse offscreen.
  if (byName) {
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }

  // Two-beat pulse then fade out. Keep the ring visible for 1.4s
  // total so the eye has time to lock on.
  setTimeout(() => {
    overlay.style.opacity = "0";
    setTimeout(() => overlay.remove(), 220);
  }, 1200);
}

function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  return s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
