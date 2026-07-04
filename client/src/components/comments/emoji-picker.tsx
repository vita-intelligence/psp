"use client";

import { useState } from "react";
import { Smile } from "lucide-react";
import dynamic from "next/dynamic";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Full Unicode picker — 1800+ emojis with search, skin-tone variants,
// category tabs. Loaded on-demand so the initial page bundle stays
// slim; the picker itself is fairly heavy (~200 KB gzipped).
const Picker = dynamic(() => import("emoji-picker-react"), { ssr: false });

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

export function EmojiPicker({
  onSelect,
  triggerAriaLabel = "Emoji",
  activeEmoji,
  align = "start",
  side = "top",
  buttonClassName,
  closeOnSelect = true,
}: {
  onSelect: (emoji: string) => void;
  triggerAriaLabel?: string;
  /** When shown as a react picker, highlight the emoji the viewer has
   *  already reacted with — click removes it. */
  activeEmoji?: string | null;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  buttonClassName?: string;
  /** Reactions pick one emoji then dismiss; composer emoji insertion
   *  benefits from staying open so the user can chain multiple picks
   *  without reopening. Default true (react semantics). */
  closeOnSelect?: boolean;
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
        className="w-auto border-0 bg-transparent p-0 shadow-none"
      >
        <div className="mb-1 flex items-center gap-0.5 rounded-full border border-border bg-popover p-1 shadow-md">
          {QUICK_REACT_EMOJIS.map((emoji) => {
            const isActive = emoji === activeEmoji;
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  onSelect(emoji);
                  if (closeOnSelect) setOpen(false);
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

        <Picker
          onEmojiClick={(data) => {
            onSelect(data.emoji);
            if (closeOnSelect) setOpen(false);
          }}
          width={340}
          height={380}
          previewConfig={{ showPreview: false }}
          searchPlaceholder="Search emoji"
          lazyLoadEmojis
        />
      </PopoverContent>
    </Popover>
  );
}
