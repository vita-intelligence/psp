"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Check,
  Columns3,
  Filter,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import type {
  DataTableColumn,
  FilterDef,
  FilterValue,
  SortSpec,
} from "./types";

// Radix Select can't carry an empty-string value — it reserves that to
// represent "no selection / show placeholder". So our "Any" option
// uses this sentinel and translates back to undefined on the way out.
const ANY_SENTINEL = "__any__";

interface ToolbarProps<T> {
  searchPlaceholder?: string;
  /** Currently-applied search term — what the server is querying on. */
  appliedSearch: string;
  onApplySearch: (next: string) => void;
  filters?: FilterDef[];
  /** Currently-applied filters — what the server is querying on. */
  appliedFilters: FilterValue;
  onApplyFilters: (next: FilterValue) => void;
  columns: DataTableColumn<T>[];
  hiddenColumns: Set<string>;
  onToggleColumn: (id: string, hidden: boolean) => void;
  /** Active sort spec. Sort menu shows it + lets the user change it
   *  without relying on clickable column headers (which only exist on
   *  the desktop table layout). */
  sort: SortSpec | null;
  onSort: (next: SortSpec | null) => void;
  actions?: React.ReactNode;
}

/**
 * Search + filter + column-visibility menu. Search & filters stage
 * locally (no debounce, no per-keystroke fetch) and commit only on
 * Enter / Apply — that's the explicit "optimised" UX the consumer
 * asked for.
 */
export function Toolbar<T>({
  searchPlaceholder = "Search…",
  appliedSearch,
  onApplySearch,
  filters,
  appliedFilters,
  onApplyFilters,
  columns,
  hiddenColumns,
  onToggleColumn,
  sort,
  onSort,
  actions,
}: ToolbarProps<T>) {
  const [searchDraft, setSearchDraft] = useState(appliedSearch);

  // Sync local draft if the outside resets (e.g. URL navigation).
  useEffect(() => {
    setSearchDraft(appliedSearch);
  }, [appliedSearch]);

  const searchDirty = searchDraft !== appliedSearch;
  const hideableColumns = columns.filter((c) => c.hideable !== false);

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      onApplySearch(searchDraft);
    }
  }

  function clearSearch() {
    setSearchDraft("");
    onApplySearch("");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search input — takes its own row on phone widths so the
          placeholder fits, then snaps back inline at `sm` where the
          input + popover buttons share a row comfortably. The four
          popovers below are narrow enough to live on a second row on
          phone without orphaning. */}
      <div className="relative basis-full sm:basis-auto sm:max-w-xs sm:flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          onKeyDown={onSearchKey}
          placeholder={searchPlaceholder ?? "Search…"}
          className={cn(
            "h-9 pl-9 pr-9",
            searchDirty && "ring-1 ring-brand/40",
          )}
        />
        {searchDraft && (
          <button
            type="button"
            onClick={clearSearch}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {searchDirty && (
        <Button
          type="button"
          size="sm"
          onClick={() => onApplySearch(searchDraft)}
        >
          Apply
        </Button>
      )}

      {filters && filters.length > 0 && (
        <FiltersMenu
          filters={filters}
          applied={appliedFilters}
          onApply={onApplyFilters}
          // Search counts as one more active criterion — wire it in so
          // the "X active" pill on the Filters button stays honest, and
          // Reset clears both search and filter dropdowns at once.
          appliedSearch={appliedSearch}
          onApplySearch={onApplySearch}
        />
      )}

      <SortMenu columns={columns} sort={sort} onSort={onSort} />

      {hideableColumns.length > 0 && (
        <ColumnsMenu
          columns={hideableColumns}
          hidden={hiddenColumns}
          onToggle={onToggleColumn}
        />
      )}

      <div className="ml-auto flex items-center gap-2">{actions}</div>
    </div>
  );
}

function SortMenu<T>({
  columns,
  sort,
  onSort,
}: {
  columns: DataTableColumn<T>[];
  sort: SortSpec | null;
  onSort: (next: SortSpec | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const sortableColumns = columns.filter((c) => c.sortField);

  if (sortableColumns.length === 0) return null;

  const activeColumn = sort
    ? sortableColumns.find((c) => c.sortField === sort.field)
    : null;

  function pick(column: DataTableColumn<T>, direction: "asc" | "desc") {
    onSort({ field: column.sortField!, direction });
    setOpen(false);
  }

  function clear() {
    onSort(null);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          <ArrowDownUp className="mr-1.5 size-3.5" />
          Sort
          {activeColumn && (
            <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-brand/10 px-1.5 text-[10px] font-semibold text-brand">
              {activeColumn.header}
              {sort?.direction === "asc" ? (
                <ArrowUp className="size-2.5" />
              ) : (
                <ArrowDown className="size-2.5" />
              )}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <div className="mb-1 px-2 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Sort by
        </div>
        <ul className="space-y-0.5">
          {sortableColumns.map((col) => {
            const labels = col.sortLabels ?? {
              asc: "Ascending",
              desc: "Descending",
            };
            const isActive = sort?.field === col.sortField;
            return (
              <li
                key={col.id}
                className="space-y-0.5 border-b border-border/40 pb-1 last:border-b-0 last:pb-0"
              >
                <div className="px-2 pt-1 text-xs font-medium text-foreground">
                  {col.header}
                </div>
                <SortRow
                  label={labels.asc}
                  active={isActive && sort?.direction === "asc"}
                  onClick={() => pick(col, "asc")}
                  direction="asc"
                />
                <SortRow
                  label={labels.desc}
                  active={isActive && sort?.direction === "desc"}
                  onClick={() => pick(col, "desc")}
                  direction="desc"
                />
              </li>
            );
          })}
        </ul>
        {sort && (
          <div className="mt-2 border-t border-border/60 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clear}
              className="w-full justify-start text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="mr-1.5 size-3.5" />
              Default order
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function SortRow({
  label,
  active,
  onClick,
  direction,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  direction: "asc" | "desc";
}) {
  const Arrow = direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
        active && "bg-muted font-medium",
      )}
    >
      <span className="inline-flex items-center gap-2">
        <Arrow
          className={cn(
            "size-3",
            active ? "text-foreground" : "text-muted-foreground/60",
          )}
        />
        <span>{label}</span>
      </span>
      {active && <Check className="size-3.5 text-brand" />}
    </button>
  );
}

function FiltersMenu({
  filters,
  applied,
  onApply,
  appliedSearch,
  onApplySearch,
}: {
  filters: FilterDef[];
  applied: FilterValue;
  onApply: (next: FilterValue) => void;
  /** Currently-applied search term — counts toward activeCount + gets
   *  cleared by the Reset button so the user has one place to wipe
   *  every active criterion. */
  appliedSearch: string;
  onApplySearch: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterValue>(applied);

  useEffect(() => {
    setDraft(applied);
  }, [applied]);

  const draftDirty = JSON.stringify(draft) !== JSON.stringify(applied);
  // Active criteria = filter dropdowns + search. Search counts as one
  // additional filter so the pill on the trigger button stays honest
  // about how much state the user has applied.
  const filterCount = Object.values(applied).filter(
    (v) => v !== "" && v !== undefined && v !== null,
  ).length;
  const activeCount = filterCount + (appliedSearch ? 1 : 0);

  function clear() {
    // Wipe BOTH filters and search — Reset is the single-button "back
    // to defaults" action. Without this, clearing filters while a
    // search was set would leave the search hanging silently.
    setDraft({});
    onApply({});
    onApplySearch("");
    setOpen(false);
  }

  function apply() {
    // Drop empty values so the URL/query is clean.
    const cleaned: FilterValue = {};
    for (const [k, v] of Object.entries(draft)) {
      if (v !== "" && v !== undefined && v !== null) cleaned[k] = v;
    }
    onApply(cleaned);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          <Filter className="mr-1.5 size-3.5" />
          Filters
          {activeCount > 0 && (
            <span className="ml-1.5 rounded-full bg-brand/10 px-1.5 text-[10px] font-semibold text-brand">
              {activeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3">
        {/* Show the applied search term inline so the user can see
            it's composed with the filter dropdowns below. Tweak it
            via the search input in the toolbar (kept separate to
            stay keyboard-friendly); Reset below clears it. */}
        {appliedSearch && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Search
            </label>
            <div className="rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 font-mono text-xs text-foreground">
              {appliedSearch}
            </div>
          </div>
        )}
        {filters.map((f) => {
          const value = draft[f.field];
          // Radix Select forbids empty-string values, so we route the
          // "Any" choice through a sentinel and translate it back to
          // "no filter" (`undefined`) on the way out.
          const stringValue =
            value === undefined || value === null ? ANY_SENTINEL : String(value);

          return (
            <div key={f.field} className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {f.label}
              </label>
              <Select
                value={stringValue}
                onValueChange={(v) =>
                  setDraft((d) => {
                    if (v === ANY_SENTINEL) {
                      const { [f.field]: _, ...rest } = d;
                      void _;
                      return rest;
                    }
                    return { ...d, [f.field]: parseFilterValue(v) };
                  })
                }
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_SENTINEL}>Any</SelectItem>
                  {f.options.map((opt) => (
                    <SelectItem key={String(opt.value)} value={String(opt.value)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
        {/* Footer:
            - Apply is the primary CTA on the right, only enabled when
              the user has actually changed something.
            - Reset appears the moment there are any active filters
              (so it's discoverable BEFORE you start staging more
              changes — not just when the draft equals "no filters").
              Click clears both draft + applied in one go. */}
        <div className="flex items-center justify-between gap-2 pt-1">
          {activeCount > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={clear}
              className="text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="mr-1.5 size-3.5" />
              Reset
            </Button>
          ) : (
            <span />
          )}
          <Button
            type="button"
            size="sm"
            onClick={apply}
            disabled={!draftDirty}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ColumnsMenu<T>({
  columns,
  hidden,
  onToggle,
}: {
  columns: DataTableColumn<T>[];
  hidden: Set<string>;
  onToggle: (id: string, hidden: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          <Columns3 className="mr-1.5 size-3.5" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 space-y-1">
        {columns.map((col) => {
          const isHidden = hidden.has(col.id);
          return (
            <label
              key={col.id}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-muted"
            >
              <Checkbox
                checked={!isHidden}
                onCheckedChange={(checked) =>
                  onToggle(col.id, !checked)
                }
              />
              <span className="text-sm">{col.header}</span>
            </label>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

function parseFilterValue(raw: string): string | boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}
