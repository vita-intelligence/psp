"use client";

// "Add column" side drawer. Lists every column the table author
// declared, grouped by `column.group` (Identity / Dates / Amounts /
// Compliance / Meta / …). Each row is a toggle; visible columns are
// on, hidden ones are off. Persists via useTableState.

import { useMemo, useState } from "react";
import { Columns3, Search, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { DataTableColumn } from "./types";

interface Props<T> {
  columns: DataTableColumn<T>[];
  hiddenColumns: Set<string>;
  onToggle: (id: string, hidden: boolean) => void;
}

const OTHER_GROUP = "Other";

export function ColumnPickerDrawer<T>({
  columns,
  hiddenColumns,
  onToggle,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const hideableColumns = useMemo(
    () => columns.filter((c) => c.hideable !== false),
    [columns],
  );

  const visibleCount = useMemo(
    () => hideableColumns.filter((c) => !hiddenColumns.has(c.id)).length,
    [hideableColumns, hiddenColumns],
  );

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? hideableColumns.filter(
          (c) =>
            c.header.toLowerCase().includes(q) ||
            (c.description ?? "").toLowerCase().includes(q) ||
            (c.group ?? "").toLowerCase().includes(q),
        )
      : hideableColumns;

    const map = new Map<string, DataTableColumn<T>[]>();
    for (const col of filtered) {
      const g = col.group ?? OTHER_GROUP;
      const list = map.get(g) ?? [];
      list.push(col);
      map.set(g, list);
    }
    // Stable insertion order — first-seen group wins. `OTHER_GROUP`
    // gets pushed to the tail explicitly.
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === OTHER_GROUP) return 1;
      if (b === OTHER_GROUP) return -1;
      return 0;
    });
  }, [hideableColumns, query]);

  function showAll() {
    for (const c of hideableColumns) {
      if (hiddenColumns.has(c.id)) onToggle(c.id, false);
    }
  }

  function hideAll() {
    for (const c of hideableColumns) {
      if (!hiddenColumns.has(c.id)) onToggle(c.id, true);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Columns3 className="size-3.5" aria-hidden />
          Columns
          <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {visibleCount}/{hideableColumns.length}
          </span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-96 flex-col p-0">
        <SheetHeader className="border-b border-border/60 px-6 py-4">
          <SheetTitle className="text-base">Columns</SheetTitle>
          <SheetDescription className="text-xs">
            Toggle any column on or off. Your view is remembered across
            sessions.
          </SheetDescription>
        </SheetHeader>

        <div className="border-b border-border/60 px-6 py-3">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search columns…"
              className="h-8 pl-7 pr-8 text-xs"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted"
                aria-label="Clear search"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>
              {visibleCount} of {hideableColumns.length} shown
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={showAll}
                className="rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
              >
                Show all
              </button>
              <span aria-hidden>·</span>
              <button
                type="button"
                onClick={hideAll}
                className="rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
              >
                Hide all
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {grouped.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No columns match &ldquo;{query}&rdquo;.
            </p>
          ) : (
            grouped.map(([group, cols]) => (
              <section key={group} className="space-y-1">
                <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group}
                </h4>
                <ul className="space-y-0.5">
                  {cols.map((col) => {
                    const isHidden = hiddenColumns.has(col.id);
                    return (
                      <li key={col.id}>
                        <label
                          className={cn(
                            "flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 hover:bg-muted",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={!isHidden}
                            onChange={() => onToggle(col.id, !isHidden)}
                            className="mt-0.5 size-3.5 rounded border-border text-brand accent-brand"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-foreground">
                              {col.header}
                            </p>
                            {col.description && (
                              <p className="text-[11px] text-muted-foreground">
                                {col.description}
                              </p>
                            )}
                          </div>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
