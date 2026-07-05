"use client";

// Emoji + count chips rendered under a bubble. Toggling a chip flips
// the viewer's `own_reacted` state on that emoji; the backend fans a
// `reaction:added` / `reaction:removed` event back through the channel
// so peers see the update live.

import { cn } from "@/lib/utils";
import type { CommentReaction } from "@/lib/comments/types";

export function ReactionsBar({
  reactions,
  isSelf,
  disabled,
  onToggle,
}: {
  reactions: CommentReaction[];
  isSelf: boolean;
  disabled: boolean;
  onToggle: (emoji: string) => void;
}) {
  if (reactions.length === 0) return null;

  // Sort order: yours first (so toggle-off is the leftmost target,
  // consistent with Telegram / Slack), then by count desc, then by
  // emoji for a stable tiebreak.
  const sorted = [...reactions].sort((a, b) => {
    if (a.own_reacted !== b.own_reacted) return a.own_reacted ? -1 : 1;
    if (a.count !== b.count) return b.count - a.count;
    return a.emoji.localeCompare(b.emoji);
  });

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {sorted.map((r) => (
        <button
          key={r.emoji}
          type="button"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            if (disabled) return;
            onToggle(r.emoji);
          }}
          aria-pressed={r.own_reacted}
          className={cn(
            "inline-flex h-5 items-center gap-1 rounded-full border px-1.5 text-[11px] leading-none transition-colors",
            r.own_reacted
              ? isSelf
                ? "border-transparent bg-brand-foreground text-brand"
                : "border-transparent bg-brand text-brand-foreground"
              : isSelf
                ? "border-brand-foreground/25 bg-background/40 text-brand-foreground/85"
                : "border-border bg-foreground/[0.04] text-muted-foreground",
            !disabled && "hover:brightness-105",
          )}
        >
          <span aria-hidden className="text-[12px] leading-none">
            {r.emoji}
          </span>
          <span className="font-medium tabular-nums">{r.count}</span>
        </button>
      ))}
    </div>
  );
}
