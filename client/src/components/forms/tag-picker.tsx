"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { StorageTag } from "@/lib/types";

interface TagPickerProps {
  /** Currently selected tag keys (e.g. ["cold-zone", "pallet"]). */
  value: string[];
  /** Full known tag list — caller fetches once at the parent level
   *  and passes it down. The picker shows everything matching the
   *  requested `kind`. */
  known: StorageTag[];
  /** Which side of the registry to filter to. `both`-tagged entries
   *  always show. */
  kind: "location" | "cell";
  /** Title used in the header (e.g. "Zone tags" vs "Level tags"). */
  label: string;
  /** Help text under the picker explaining what these tags do. */
  help?: string;
  readOnly?: boolean;
  onCommit: (next: string[]) => void;
}

/** Chip-based multi-select. Selected tags appear as chips at the
 *  top; a search input below filters the registry. Clicking a tag
 *  toggles it. There's a small footer link to the admin page so
 *  operators can jump there if a tag they need is missing. */
export function TagPicker({
  value,
  known,
  kind,
  label,
  help,
  readOnly,
  onCommit,
}: TagPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  const available = useMemo(
    () =>
      known.filter((t) => t.kind === kind || t.kind === "both"),
    [known, kind],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return available;
    return available.filter(
      (t) =>
        t.key.includes(q) ||
        t.label.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q),
    );
  }, [available, query]);

  // Resolve selected keys to known tag rows; unknown selections (e.g.
  // tags that were deleted from the registry after they were
  // assigned) still display so the operator sees there's a problem.
  const chips = useMemo(() => {
    const byKey = new Map(available.map((t) => [t.key, t]));
    return value.map((k) => ({
      key: k,
      label: byKey.get(k)?.label ?? k,
      missing: !byKey.has(k),
    }));
  }, [value, available]);

  // Close on click outside.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const toggle = (key: string) => {
    if (readOnly) return;
    const next = value.includes(key)
      ? value.filter((k) => k !== key)
      : [...value, key];
    onCommit(next);
  };

  // Suggested chips — the registry minus what's already selected,
  // capped so the row stays one line on most viewports. One-click
  // adds. This is the "don't forget to tag" nudge: every operator
  // sees the company's vocabulary right there at the form.
  const suggestions = useMemo(
    () => available.filter((t) => !value.includes(t.key)).slice(0, 6),
    [available, value],
  );

  return (
    <div className="space-y-1.5" ref={containerRef}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>

      {!readOnly && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {suggestions.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => toggle(t.key)}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-background px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:border-primary hover:text-primary"
              title={t.description ?? `Add ${t.label}`}
            >
              <Plus className="size-2.5" />
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Selected chips */}
      <div className="flex flex-wrap gap-1">
        {chips.length === 0 ? (
          <span className="text-[11px] text-muted-foreground">
            No tags assigned.
          </span>
        ) : (
          chips.map((c) => (
            <span
              key={c.key}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px]",
                c.missing
                  ? "bg-destructive/15 text-destructive"
                  : "bg-foreground/10 text-foreground",
              )}
              title={c.missing ? "Tag no longer in the registry" : c.label}
            >
              {c.label}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => toggle(c.key)}
                  className="hover:text-foreground/60"
                  aria-label={`Remove ${c.label}`}
                >
                  <X className="size-2.5" />
                </button>
              )}
            </span>
          ))
        )}
      </div>

      {!readOnly && (
        <div className="relative">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setOpen((o) => !o)}
            className="h-8 w-full justify-between text-xs"
          >
            <span>Add or remove tags</span>
            <ChevronDown className="size-3.5" />
          </Button>

          {open && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[280px] overflow-y-auto rounded-md border border-border bg-background shadow-lg">
              <div className="sticky top-0 border-b border-border/60 bg-background p-2">
                <Input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search tags…"
                  className="h-7 text-xs"
                />
              </div>

              {filtered.length === 0 ? (
                <p className="px-3 py-4 text-center text-[11px] text-muted-foreground">
                  No tags match. Manage the list at{" "}
                  <Link
                    href="/settings/storage-tags"
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    /settings/storage-tags
                  </Link>
                  .
                </p>
              ) : (
                <ul className="py-1">
                  {filtered.map((t) => {
                    const active = value.includes(t.key);
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => toggle(t.key)}
                          className={cn(
                            "flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs",
                            "hover:bg-muted/60",
                            active && "bg-primary/[0.08]",
                          )}
                        >
                          <span
                            className={cn(
                              "mt-0.5 inline-flex size-3 shrink-0 items-center justify-center rounded-sm border",
                              active
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border",
                            )}
                          >
                            {active && (
                              <svg
                                viewBox="0 0 16 16"
                                fill="none"
                                className="size-2.5"
                              >
                                <path
                                  d="M3 8.5l3 3 7-7"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="font-medium">{t.label}</span>
                            <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                              {t.key}
                            </span>
                            {t.description && (
                              <span className="block text-[10px] text-muted-foreground">
                                {t.description}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="border-t border-border/60 bg-muted/30 px-3 py-2 text-[10px]">
                <Link
                  href="/settings/storage-tags"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <Plus className="size-3" />
                  Manage the tag registry
                </Link>
              </div>
            </div>
          )}
        </div>
      )}

      {help && (
        <p className="text-[10px] leading-snug text-muted-foreground">
          {help}
        </p>
      )}
    </div>
  );
}
