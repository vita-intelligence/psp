"use client";

// Lightweight emoji picker. NOT a full Unicode-database picker — that
// would require the `emoji-mart` package we're deliberately not
// depending on. Instead we ship a hand-curated set covering the
// emoji people actually reach for in a manufacturing / procurement
// discussion (thumbs up, warning, tick, cross, plus a small emotional
// spread). A follow-up can wire `@emoji-mart/react` if a broader
// vocabulary becomes necessary.

import { useState } from "react";
import { Smile } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Quick-react emojis rendered as a horizontal bar at the top of the
 *  picker — same shortlist the bubble's hover-quick-react uses so a
 *  user's muscle memory works across surfaces. */
export const QUICK_REACT_EMOJIS = [
  "👍",
  "❤️",
  "😂",
  "😮",
  "😢",
  "🙏",
  "🔥",
] as const;

// Larger set exposed by the "full" tab. Curated for PSP's audience —
// heavy on approve / block / warn / follow-up signals plus a modest
// social spread. Categorised in-source so we can render section
// headers without a Unicode block lookup at runtime.
const FULL_SET: { label: string; items: string[] }[] = [
  {
    label: "Reactions",
    items: [
      "👍", "👎", "❤️", "😂", "😮", "😢", "🙏", "🔥",
      "🎉", "🚀", "💯", "👀", "🤔", "🙌", "👏", "🤝",
    ],
  },
  {
    label: "Signals",
    items: [
      "✅", "❌", "⚠️", "🚫", "🛑", "⏳", "⏰", "📌",
      "📎", "📝", "🔒", "🔓", "🔍", "📦", "🏷️", "⭐",
    ],
  },
  {
    label: "People",
    items: [
      "😀", "😅", "😊", "😉", "😍", "😎", "🤗", "🤨",
      "😴", "🥱", "😤", "😳", "😱", "🤯", "🥳", "😇",
    ],
  },
];

export function EmojiPicker({
  onSelect,
  triggerAriaLabel = "Emoji",
  activeEmoji,
  align = "start",
  side = "top",
  buttonClassName,
}: {
  onSelect: (emoji: string) => void;
  triggerAriaLabel?: string;
  /** When shown as a react picker, highlight the emoji the viewer has
   *  already reacted with — click removes it. */
  activeEmoji?: string | null;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={triggerAriaLabel}
          title={triggerAriaLabel}
          className={cn(
            "inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            buttonClassName,
          )}
        >
          <Smile className="size-4" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={6}
        className="w-72 p-2"
      >
        <div className="mb-2 flex items-center gap-0.5 rounded-full border border-border bg-muted/40 p-1">
          {QUICK_REACT_EMOJIS.map((emoji) => {
            const isActive = emoji === activeEmoji;
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  onSelect(emoji);
                  setOpen(false);
                }}
                aria-label={emoji}
                aria-pressed={isActive}
                className={cn(
                  "flex size-8 items-center justify-center rounded-full text-[18px] leading-none transition-transform",
                  isActive && "bg-brand/25 ring-1 ring-brand/50",
                  "hover:scale-110 hover:bg-foreground/[0.06]",
                  "active:scale-95",
                )}
              >
                <span aria-hidden>{emoji}</span>
              </button>
            );
          })}
        </div>

        <div className="max-h-64 overflow-y-auto pr-1">
          {FULL_SET.map((section) => (
            <div key={section.label} className="mb-2 last:mb-0">
              <p className="mb-1 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                {section.label}
              </p>
              <div className="grid grid-cols-8 gap-0.5">
                {section.items.map((emoji) => {
                  const isActive = emoji === activeEmoji;
                  return (
                    <button
                      key={section.label + emoji}
                      type="button"
                      onClick={() => {
                        onSelect(emoji);
                        setOpen(false);
                      }}
                      aria-label={emoji}
                      className={cn(
                        "flex size-8 items-center justify-center rounded-md text-[18px] leading-none transition-colors",
                        isActive
                          ? "bg-brand/25 ring-1 ring-brand/50"
                          : "hover:bg-foreground/[0.06]",
                      )}
                    >
                      <span aria-hidden>{emoji}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
