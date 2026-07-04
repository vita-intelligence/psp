"use client";

// Floating B / I / S / Code popover that appears above a text
// selection inside the RichComposer. Portal-rendered with position:
// fixed so the popover escapes whatever stacking context the composer
// lives in (a Card, a Dialog, etc.).
//
// Critical UX trick: `onMouseDown → preventDefault()` on each button.
// Without it, clicking the button blurs the editor and the browser
// collapses the selection to a caret; by the time `onClick` fires the
// range is empty.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ActiveFormats, FormatKind } from "./rich-composer";
import { cn } from "@/lib/utils";

const POPOVER_HEIGHT_PX = 36;
const POPOVER_GAP_PX = 8;
const POPOVER_WIDTH_ESTIMATE_PX = 190;
const VIEWPORT_PADDING_PX = 8;

export function FormattingToolbar({
  rect,
  active,
  onApply,
}: {
  rect: DOMRect | null;
  active: ActiveFormats;
  onApply: (format: FormatKind) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || !rect) return null;

  const idealX = rect.left + rect.width / 2;
  const halfW = POPOVER_WIDTH_ESTIMATE_PX / 2;
  const minX = halfW + VIEWPORT_PADDING_PX;
  const maxX =
    (typeof window !== "undefined" ? window.innerWidth : 1024) -
    halfW -
    VIEWPORT_PADDING_PX;
  const x = Math.max(minX, Math.min(maxX, idealX));

  const naturalY = rect.top - POPOVER_HEIGHT_PX - POPOVER_GAP_PX;
  const fallbackY = rect.top + rect.height + POPOVER_GAP_PX;
  const y = naturalY < VIEWPORT_PADDING_PX ? fallbackY : naturalY;

  return createPortal(
    <div
      role="toolbar"
      aria-label="Text formatting"
      style={{
        position: "fixed",
        left: x,
        top: y,
        transform: "translateX(-50%)",
      }}
      className={cn(
        "z-[60] flex items-center gap-0.5 rounded-full border border-border bg-popover p-1 text-popover-foreground shadow-lg",
        "animate-in fade-in zoom-in-95 duration-150",
      )}
    >
      <FormatButton
        label="Bold"
        shortcut="⌘B"
        active={active.bold}
        onApply={() => onApply("bold")}
      >
        <span className="font-bold">B</span>
      </FormatButton>
      <FormatButton
        label="Italic"
        shortcut="⌘I"
        active={active.italic}
        onApply={() => onApply("italic")}
      >
        <span className="font-serif italic">I</span>
      </FormatButton>
      <FormatButton
        label="Strike"
        shortcut="⌘⇧X"
        active={active.strike}
        onApply={() => onApply("strike")}
      >
        <span className="line-through">S</span>
      </FormatButton>
      <FormatButton
        label="Code"
        shortcut="⌘⇧M"
        active={active.code}
        onApply={() => onApply("code")}
      >
        <span className="font-mono text-[12px]">{"</>"}</span>
      </FormatButton>
    </div>,
    document.body,
  );
}

function FormatButton({
  label,
  shortcut,
  active,
  onApply,
  children,
}: {
  label: string;
  shortcut: string;
  active: boolean;
  onApply: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      // Prevent focus loss so the selection survives the click.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.preventDefault();
        onApply();
      }}
      aria-pressed={active}
      aria-label={`${label} (${shortcut})`}
      title={`${label} (${shortcut})`}
      className={cn(
        "inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-[13px] transition-colors",
        "focus-visible:outline-none active:scale-95",
        active
          ? "bg-brand text-brand-foreground shadow-sm"
          : "text-muted-foreground hover:bg-brand/15 hover:text-foreground focus-visible:bg-brand/15 focus-visible:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
