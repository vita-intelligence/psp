"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Toolbar } from "./toolbar";
import { DraggableHeader } from "./draggable-header";
import { FilterRow } from "./filter-row";
import { useTableState } from "./use-table-state";
import { useEntityChannel } from "@/lib/realtime/use-entity-channel";
import type {
  ColumnFilterValue,
  DataTableColumn,
  DataTableProps,
  FilterValue,
  PageResult,
  SortSpec,
} from "./types";

/**
 * Generic server-driven table. The same component drives every list
 * page (warehouses, orders, products, audit log, …): pass the columns,
 * the row key, and a `fetchPage` function. Server-side pagination,
 * search, filter, sort. Client-side column reorder / hide. Mobile
 * cards on `< md:`.
 *
 * Key UX rules:
 *
 *   * Search + filters **never** fire on every keystroke. They commit
 *     on Enter / explicit Apply only — fewer DB hits, no jittery
 *     loading state while you're still typing.
 *   * Column order + visibility persist in `localStorage` per `tableId`
 *     so a user's preference survives reloads.
 *   * Pagination uses opaque cursors → constant-time per page no matter
 *     how deep you scroll. Infinite-query under the hood; an
 *     IntersectionObserver on a sentinel at the bottom of the list
 *     auto-fetches the next page as the user nears it. A button
 *     fallback stays visible for keyboard users + when the observer
 *     can't run (no JS, blocked by an extension).
 */
export function DataTable<T>({
  tableId,
  columns,
  rowKey,
  fetchPage,
  initialPage,
  searchPlaceholder,
  filters,
  defaultSort,
  onRowClick,
  pageSize = 25,
  emptyState,
  toolbarActions,
  beforeTable,
  renderMobileCard,
  realtimeEntity,
}: DataTableProps<T>) {
  const defaultHiddenIds = useMemo(
    () => columns.filter((c) => c.defaultHidden).map((c) => c.id),
    [columns],
  );
  const {
    columnOrder: persistedOrder,
    hiddenColumns,
    columnFilters,
    setColumnOrder,
    toggleColumn,
    setColumnFilter,
    clearAllColumnFilters,
  } = useTableState(tableId, defaultHiddenIds);

  const [sort, setSort] = useState<SortSpec | null>(defaultSort ?? null);
  const [appliedSearch, setAppliedSearch] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<FilterValue>({});

  // Compose the ordered, visible column list each render. Persisted
  // order wins when present; new columns (introduced by a code change)
  // land at the end of the visible list.
  const orderedColumns = useMemo(() => {
    const resolved = resolveColumnOrder(columns, persistedOrder).filter(
      (c) => !hiddenColumns.has(c.id),
    );
    if (process.env.NODE_ENV !== "production") {
      const seen = new Set<string>();
      const dups: string[] = [];
      for (const c of resolved) {
        if (seen.has(c.id)) dups.push(c.id);
        else seen.add(c.id);
      }
      if (dups.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[DataTable:${tableId}] duplicate column id(s) after resolve: ${dups.join(", ")} — check the columns prop or clear localStorage key dataTable.${tableId}`,
        );
      }
    }
    return resolved;
  }, [columns, persistedOrder, hiddenColumns, tableId]);

  const queryKey = [
    "data-table",
    tableId,
    appliedSearch,
    sort?.field ?? "",
    sort?.direction ?? "",
    JSON.stringify(appliedFilters),
    JSON.stringify(columnFilters),
    pageSize,
  ];

  // Tenant-scoped realtime — subscribe once per entity/tableId and
  // let a peer's write flag our TanStack cache stale + refresh the
  // SSR page. Invalidate keyed on the *prefix* `["data-table", tableId]`
  // so every filter/sort permutation of this table refetches, not
  // just the one the current user is looking at.
  useEntityChannel({
    entity: realtimeEntity ?? "",
    invalidateQueryKey: ["data-table", tableId],
    disabled: !realtimeEntity,
  });

  // The server-pre-fetched first page is only valid for the very
  // first query (default sort, no search, no filters). If we hand it
  // to every query key, TanStack treats it as fresh data after the
  // user changes search/filter/sort and never refetches — which
  // looks like "filters don't work". Provide initialData only when
  // the query state matches the prefetch.
  const isPristine =
    appliedSearch === "" &&
    Object.keys(appliedFilters).length === 0 &&
    Object.keys(columnFilters).length === 0 &&
    (!sort ||
      (sort.field === (defaultSort?.field ?? null) &&
        sort.direction === (defaultSort?.direction ?? "asc")));

  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      fetchPage({
        cursor: pageParam,
        limit: pageSize,
        sort,
        filters: appliedFilters,
        columnFilters,
        search: appliedSearch,
      }),
    getNextPageParam: (last) => last.next_cursor,
    initialData:
      isPristine && initialPage
        ? { pages: [initialPage], pageParams: [null] }
        : undefined,
    // Refetch on key change. Tables are interactive; users expect a
    // search press to fire a query, not be silently cached.
    staleTime: 0,
  });

  const rows: T[] = useMemo(() => {
    const flat = query.data?.pages.flatMap((p) => p.items) ?? [];
    // Defensive dedupe by rowKey — pagination overlap (e.g. a row's
    // sort position shifting between fetches) can produce the same row
    // twice in the flattened array. React then complains about
    // duplicate keys; uniqueness here is cheap and correct.
    const seen = new Set<string>();
    const dups: string[] = [];
    const out: T[] = [];
    for (const row of flat) {
      const k = rowKey(row);
      if (seen.has(k)) {
        dups.push(k);
        continue;
      }
      seen.add(k);
      out.push(row);
    }
    if (process.env.NODE_ENV !== "production" && dups.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[DataTable:${tableId}] dropped duplicate rowKey(s): ${dups.join(", ")} — server returned the same row twice across pagination`,
      );
    }
    return out;
  }, [query.data, rowKey, tableId]);

  const isInitialLoading = query.isPending && !query.data;
  const hasNoData =
    !isInitialLoading && rows.length === 0 && !query.isError;
  const isFiltered =
    appliedSearch.length > 0 ||
    Object.keys(appliedFilters).length > 0 ||
    Object.keys(columnFilters).length > 0;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedColumns.findIndex((c) => c.id === active.id);
    const newIndex = orderedColumns.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const fullVisible = orderedColumns.map((c) => c.id);
    const reordered = arrayMove(fullVisible, oldIndex, newIndex);

    // Persist order — include hidden columns at the end so toggling
    // them back on lands them in a stable spot.
    const hiddenIds = columns
      .filter((c) => hiddenColumns.has(c.id))
      .map((c) => c.id);
    setColumnOrder([...reordered, ...hiddenIds]);
  }

  function onSort(field?: string) {
    if (!field) return;
    setSort((current) => {
      if (current?.field !== field) return { field, direction: "asc" };
      if (current.direction === "asc")
        return { field, direction: "desc" };
      return null; // third click clears
    });
  }

  function onHeaderSortPick(
    field: string | undefined,
    direction: "asc" | "desc" | null,
  ) {
    if (!field) return;
    if (direction === null) {
      setSort(null);
      return;
    }
    setSort({ field, direction });
  }

  return (
    <div className="space-y-3">
      <Toolbar
        searchPlaceholder={searchPlaceholder}
        appliedSearch={appliedSearch}
        onApplySearch={setAppliedSearch}
        filters={filters}
        appliedFilters={appliedFilters}
        onApplyFilters={setAppliedFilters}
        columns={columns}
        hiddenColumns={hiddenColumns}
        onToggleColumn={toggleColumn}
        columnFilters={columnFilters}
        onClearColumnFilter={(field) => setColumnFilter(field, null)}
        onClearAllColumnFilters={clearAllColumnFilters}
        sort={sort}
        onSort={setSort}
        actions={toolbarActions}
      />

      {beforeTable}

      {query.isError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/[0.03] px-3 py-3 text-sm">
          <div className="flex items-start gap-2 text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>Couldn&apos;t load this list.</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
            className="mt-2"
          >
            <RefreshCw className="mr-1.5 size-3.5" />
            Try again
          </Button>
        </div>
      )}

      {/* Responsive split driven by container queries, not viewport.
          The table view switches in once the wrapper itself (not the
          viewport) is wide enough to comfortably hold the columns —
          so the same component looks right inside a sidebar layout,
          a half-width modal, or a full-page list, without re-tuning
          the breakpoint per use site. */}
      <div className="relative @container/data-table">
        {/* Thin indeterminate progress bar across the top of the
            container whenever a server refetch is in flight. Includes
            sort changes, filter applies, search, and "Load more".
            Gives a clear visual ack even when the result set is small
            (or unchanged) so the user knows the round-trip happened. */}
        {(query.isFetching || query.isFetchingNextPage) && !isInitialLoading && (
          <div
            aria-hidden
            className="absolute -top-1 left-0 right-0 z-10 h-0.5 overflow-hidden rounded-full"
          >
            <div className="h-full w-1/3 animate-[progress-slide_1s_ease-in-out_infinite] rounded-full bg-brand" />
          </div>
        )}

        {/* Desktop table — visible once container >= 42rem (~672px) */}
        <div className="hidden overflow-hidden rounded-lg border border-border/60 @2xl/data-table:block">
        <DndContext
          id={`dt-${tableId}`}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <SortableContext
                  items={orderedColumns.map((c) => c.id)}
                  strategy={horizontalListSortingStrategy}
                >
                  {orderedColumns.map((col) => (
                    <DraggableHeader
                      key={col.id}
                      column={col}
                      sort={sort}
                      onSort={(direction) =>
                        onHeaderSortPick(col.sortField, direction)
                      }
                      onHide={() => toggleColumn(col.id, true)}
                    />
                  ))}
                </SortableContext>
              </TableRow>
              {/* Persistent filter row — one compact input per column,
                  always visible so the operator sees every available
                  filter without opening a dropdown. Matches the
                  MRPEasy / Airtable convention. Only renders when at
                  least one column has a filterKind declared. */}
              {orderedColumns.some((c) => c.filterKind && c.filterField) && (
                <FilterRow
                  columns={orderedColumns}
                  values={columnFilters}
                  onChange={(field, value) => setColumnFilter(field, value)}
                />
              )}
            </TableHeader>
            <TableBody>
              {isInitialLoading ? (
                <SkeletonRows
                  columns={orderedColumns.length}
                  rows={Math.min(pageSize, 6)}
                />
              ) : hasNoData ? (
                <TableRow>
                  <TableCell
                    colSpan={orderedColumns.length || 1}
                    className="py-12 text-center text-sm text-muted-foreground"
                  >
                    {isFiltered
                      ? "No results for the current search / filters."
                      : (emptyState ?? "Nothing here yet.")}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow
                    key={rowKey(row)}
                    data-collab-id={`row:${tableId}:${rowKey(row)}`}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      onRowClick && "cursor-pointer",
                    )}
                  >
                    {orderedColumns.map((col) => (
                      <TableCell
                        key={col.id}
                        className={cn(
                          col.align === "right" && "text-right",
                          col.align === "center" && "text-center",
                          col.widthClassName,
                        )}
                      >
                        {col.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </DndContext>
        </div>

        {/* Card layout — visible until container >= 42rem. Uses the
            consumer's `renderMobileCard` when provided (hand-crafted
            hierarchy), or falls back to a generic `LABEL — value`
            stack from the column defs. */}
        <div className="space-y-2 @2xl/data-table:hidden">
          {isInitialLoading ? (
            <MobileCardSkeletons rows={Math.min(pageSize, 4)} />
          ) : hasNoData ? (
            <div className="rounded-md border border-dashed border-border/60 py-10 text-center text-sm text-muted-foreground">
              {isFiltered
                ? "No results for the current search / filters."
                : (emptyState ?? "Nothing here yet.")}
            </div>
          ) : (
            rows.map((row) => (
              <button
                key={rowKey(row)}
                type="button"
                data-collab-id={`row:${tableId}:${rowKey(row)}`}
                onClick={() => onRowClick?.(row)}
                className={cn(
                  "block w-full rounded-md border border-border/60 bg-background p-3 text-left",
                  onRowClick && "transition-colors hover:bg-muted/30",
                )}
              >
                {renderMobileCard ? (
                  renderMobileCard(row)
                ) : (
                  <dl className="space-y-1.5">
                    {orderedColumns.map((col) => (
                      <div
                        key={col.id}
                        className="flex items-start justify-between gap-3"
                      >
                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                          {col.header}
                        </dt>
                        <dd className="min-w-0 text-right text-sm">
                          {(col.mobileCell ?? col.cell)(row)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      <Pagination
        rowsLoaded={rows.length}
        hasMore={Boolean(query.hasNextPage)}
        isFetchingMore={query.isFetchingNextPage}
        onLoadMore={() => query.fetchNextPage()}
      />
    </div>
  );
}

function Pagination({
  rowsLoaded,
  hasMore,
  isFetchingMore,
  onLoadMore,
}: {
  rowsLoaded: number;
  hasMore: boolean;
  isFetchingMore: boolean;
  onLoadMore: () => void;
}) {
  // Sentinel that, when scrolled into view, fires onLoadMore. 200px of
  // rootMargin means the next page starts fetching just before the
  // operator hits the bottom — no perceptible pause.
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Keep the loader callback fresh inside the observer closure without
  // recreating the observer on every render (which would cause it to
  // refire immediately).
  const loadRef = useRef(onLoadMore);
  loadRef.current = onLoadMore;

  useEffect(() => {
    if (!hasMore || isFetchingMore) return;
    const el = sentinelRef.current;
    if (!el) return;

    // After a page resolves the sentinel can still be inside the
    // viewport (dense rows, tall screens, or a short page). An
    // IntersectionObserver only fires on ratio transitions, so a
    // "stayed visible" sentinel never re-triggers → the scroll
    // silently stalls. Check the rect first and fire immediately
    // if we're still in range.
    const viewportH =
      window.innerHeight || document.documentElement.clientHeight || 0;
    const rect = el.getBoundingClientRect();
    if (rect.top < viewportH + 200) {
      loadRef.current();
      return;
    }

    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            loadRef.current();
            // One trigger per page-fetch is enough; React state
            // (`isFetchingMore` flipping) tears this observer down
            // and the next render re-creates a fresh one for the
            // following page.
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, isFetchingMore]);

  if (rowsLoaded === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          Showing{" "}
          <span className="font-medium text-foreground">{rowsLoaded}</span>{" "}
          {rowsLoaded === 1 ? "row" : "rows"}
          {hasMore ? "" : " — all loaded"}
        </span>
        {/* Keyboard/no-JS fallback. Hidden once the observer has
            tripped because `isFetchingMore` disables it anyway. */}
        {hasMore && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onLoadMore}
            disabled={isFetchingMore}
            className="text-xs text-muted-foreground"
          >
            {isFetchingMore ? (
              <>
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                Loading…
              </>
            ) : (
              "Load more"
            )}
          </Button>
        )}
      </div>

      {hasMore && (
        <>
          {/* Invisible 1px sentinel observed by IntersectionObserver.
              Sits below the visible footer text so by the time it
              enters the viewport the next page is queued. */}
          <div ref={sentinelRef} aria-hidden className="h-px" />
          {isFetchingMore && (
            <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Loading more…
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SkeletonRows({
  columns,
  rows,
}: {
  columns: number;
  rows: number;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: Math.max(columns, 1) }).map((_, j) => (
            <TableCell key={j} className="py-3">
              <div className="h-4 w-full max-w-32 animate-pulse rounded bg-muted" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function MobileCardSkeletons({ rows }: { rows: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-20 w-full animate-pulse rounded-md border border-border/60 bg-muted/30"
        />
      ))}
    </>
  );
}

function resolveColumnOrder<T>(
  defs: DataTableColumn<T>[],
  persisted: string[] | null,
): DataTableColumn<T>[] {
  if (!persisted || persisted.length === 0) return defs;
  const byId = new Map(defs.map((c) => [c.id, c]));
  const ordered: DataTableColumn<T>[] = [];
  const seen = new Set<string>();
  // Persisted order can contain duplicates if older code (or a buggy
  // reorder) wrote a malformed array. Skip anything we've already
  // placed so we never produce a duplicate-id column list — duplicate
  // ids mean duplicate React keys on TableCell, which React surfaces
  // as the misleading "missing key" warning.
  for (const id of persisted) {
    if (seen.has(id)) continue;
    const col = byId.get(id);
    if (col) {
      ordered.push(col);
      seen.add(id);
    }
  }
  // Append any columns the user hasn't manually positioned yet (new
  // additions, etc.) at the end so they're discoverable.
  for (const col of defs) {
    if (!seen.has(col.id)) ordered.push(col);
  }
  return ordered;
}
