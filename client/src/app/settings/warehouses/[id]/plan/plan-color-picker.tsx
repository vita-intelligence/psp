"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { COLOR_PALETTE, isHexColor } from "./plan-utils";

interface ColorPickerProps {
  /** Currently-applied `#RRGGBB` colour, or null for "use default". */
  value: string | null | undefined;
  /** Visible colour to display in the swatches' "active ring" when the
   *  user hasn't overridden — i.e. the colour the renderer falls back
   *  to. Lets the picker show a meaningful preview for unsaved
   *  defaults (e.g. the kind's stock palette for a location). */
  defaultColor?: string;
  readOnly?: boolean;
  /** Called with the new hex when a swatch / valid hex is picked, or
   *  `null` when the user resets to default. */
  onChange: (next: string | null) => void;
}

/** Inline colour picker — 12 swatches + a hex input + a clear button.
 *  Reused across wall / outline / hole / location bodies (and the
 *  multi-select body) so painting feels consistent everywhere. */
export function ColorPicker({
  value,
  defaultColor,
  readOnly,
  onChange,
}: ColorPickerProps) {
  // Local mirror so the hex input stays editable while the user types
  // an invalid prefix — we only commit upstream once it parses. Reset
  // whenever the upstream value changes (multi-select, undo / redo).
  const [draft, setDraft] = useState<string>(value ?? "");
  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  const active = isHexColor(value) ? value.toLowerCase() : null;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-6 gap-1.5">
        {COLOR_PALETTE.map((c) => {
          const isActive = active === c.toLowerCase();
          return (
            <button
              key={c}
              type="button"
              disabled={readOnly}
              onClick={() => onChange(c)}
              className={cn(
                "relative aspect-square rounded-md border transition",
                "hover:scale-[1.06] focus:outline-none focus-visible:ring-2",
                "focus-visible:ring-primary focus-visible:ring-offset-1",
                isActive
                  ? "border-foreground/80 ring-2 ring-primary"
                  : "border-border/60",
                readOnly && "cursor-not-allowed opacity-50",
              )}
              style={{ backgroundColor: c }}
              aria-label={`Pick ${c}`}
            >
              {isActive && (
                <Check className="absolute inset-0 m-auto size-3.5 text-white drop-shadow-sm" />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5">
        <div
          className="size-7 shrink-0 rounded-md border border-border/60"
          style={{
            backgroundColor: active ?? defaultColor ?? "transparent",
          }}
          aria-hidden
        />
        <Input
          value={draft}
          onChange={(e) => {
            const next = e.target.value.trim();
            setDraft(next);
            // Auto-commit when the typed value is a valid hex; otherwise
            // wait — avoids blowing away the picked colour while the
            // user is mid-typing.
            if (isHexColor(next)) onChange(next.toLowerCase());
          }}
          placeholder="#3b82f6"
          spellCheck={false}
          autoComplete="off"
          maxLength={7}
          disabled={readOnly}
          className="h-8 font-mono text-[12px]"
        />
        {active && !readOnly && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft("");
              onChange(null);
            }}
            className="size-8 shrink-0 px-0"
            aria-label="Reset to default colour"
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
