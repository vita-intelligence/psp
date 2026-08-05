"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { Factory, FlaskConical } from "lucide-react";
import { DataTable } from "@/components/data-table";
import type {
  ColumnFilterValue,
  DataTableColumn,
  FilterDef,
  PageResult,
  SortSpec,
} from "@/components/data-table";
import { serializeColumnFilters } from "@/lib/data-table/serialize";
import { Badge } from "@/components/ui/badge-mini";
import { cn } from "@/lib/utils";
import { formatCompanyDate, formatCompanyNumber } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import type {
  ManufacturingOrderLedgerPage,
  ManufacturingOrderStatus,
  ManufacturingOrderSummary,
} from "@/lib/production/types";

interface Props {
  initialPage: ManufacturingOrderLedgerPage;
  /** Server-resolved stream from the URL. When absent / unknown the
   *  page component defaults to `production` — the ledger trusts this
   *  as the initial paint state. */
  initialStream: Stream;
  /** Location filters built server-side via `buildLocationFilters()`. */
  locationFilters?: FilterDef[];
}

// Ledger stream tab. `production` = normal MOs (the ~95% case);
// `rnd` = trial + sample MOs (created from NPD trial batches);
// `all` = both, with a row-level R&D chip so the R&D rows are
// still visually unmistakable. Default = production so the shop-
// floor planner isn't confused by trial-batch runs.
type Stream = "production" | "rnd" | "all";

function normaliseStream(raw: string | null | undefined): Stream {
  return raw === "rnd" || raw === "all" ? raw : "production";
}

function isRndProjectType(pt: string | undefined): boolean {
  return pt === "trial" || pt === "sample";
}

const DEFAULT_SORT: SortSpec = { field: "inserted_at", direction: "desc" };

const STATUS_TONE: Record<
  ManufacturingOrderStatus,
  "muted" | "amber" | "emerald" | "destructive" | "indigo" | "sky"
> = {
  draft: "muted",
  prepared: "amber",
  approved: "indigo",
  scheduled: "sky",
  in_progress: "amber",
  completed: "emerald",
  cancelled: "destructive",
};

const STATUS_LABEL: Record<ManufacturingOrderStatus, string> = {
  draft: "Draft",
  prepared: "Awaiting approval",
  approved: "Approved",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_OPTIONS = (
  Object.keys(STATUS_LABEL) as ManufacturingOrderStatus[]
).map((s) => ({ label: STATUS_LABEL[s], value: s }));

const STATUS_FILTER: FilterDef = {
  field: "status",
  label: "Status",
  options: STATUS_OPTIONS,
};

function buildFetchPage(stream: Stream) {
  return async function fetchPage(params: {
    cursor: string | null;
    limit: number;
    sort: SortSpec | null;
    filters: Record<string, string | boolean | number>;
    columnFilters: Record<string, ColumnFilterValue>;
    search: string;
  }): Promise<PageResult<ManufacturingOrderSummary>> {
    const qs = new URLSearchParams();
    qs.set("limit", String(params.limit));
    if (params.cursor) qs.set("cursor", params.cursor);
    if (params.sort)
      qs.set("sort", `${params.sort.field}:${params.sort.direction}`);
    if (params.search) qs.set("search", params.search);
    for (const [k, v] of Object.entries(params.filters)) {
      qs.set(k, String(v));
    }
    serializeColumnFilters(qs, params.columnFilters);
    // Bind the actual `stream` value into the closure (not a ref).
    // Refs updated in useEffect race with children's mount effects:
    // React runs child effects first, so the DataTable's queryFn
    // would fire BEFORE the parent's ref-sync effect, and read the
    // stale stream. Passing the value in via `useMemo([stream])`
    // reruns the closure at render time so the fetch is always
    // aligned with the URL-resolved stream.
    if (stream && stream !== "all") qs.set("stream", stream);
    const res = await fetch(
      `/api/production/manufacturing-orders?${qs.toString()}`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { detail?: string };
        if (body?.detail) detail = body.detail;
      } catch {
        /* leave */
      }
      throw new Error(detail);
    }
    return (await res.json()) as PageResult<ManufacturingOrderSummary>;
  };
}

const STREAM_TABS: Array<{ value: Stream; label: string; hint: string }> = [
  {
    value: "production",
    label: "Production",
    hint: "Normal manufacturing runs — the default shop-floor view.",
  },
  {
    value: "rnd",
    label: "R&D",
    hint: "Trial + sample MOs created from NPD trial batches.",
  },
  {
    value: "all",
    label: "All",
    hint: "Both streams. R&D rows are chipped so you can still spot them.",
  },
];

function StreamTabStrip({
  stream,
  onChange,
}: {
  stream: Stream;
  onChange: (next: Stream) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Manufacturing order stream"
      className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 p-1 text-sm"
    >
      {STREAM_TABS.map((t) => {
        const active = t.value === stream;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={t.hint}
            onClick={() => onChange(t.value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function ManufacturingOrdersLedger({
  initialPage,
  initialStream,
  locationFilters,
}: Props) {
  const prefs = useFormatPrefs();

  // URL query param is the single source of truth for the stream tab.
  // That kills the earlier desync: server-fetched initial page,
  // client-side tab state, and the request that fires on mount all
  // now derive from the same `?stream=…` value. Deep-links, refresh,
  // and browser back/forward work without a reconciliation flicker.
  //
  // Personalisation (remember last choice on a bare `/manufacturing-
  // orders` visit) still works via a redirect below — cheap and keeps
  // the URL canonical.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlStream = normaliseStream(searchParams.get("stream"));
  const stream: Stream = urlStream;

  // Persist last-chosen stream so a bare `/manufacturing-orders` visit
  // lands on it. Skipped when URL already carries a `?stream=` so
  // deep-links win over personalisation.
  const STREAM_STORAGE_KEY = "psp.mos.stream";
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (searchParams.get("stream")) {
      window.localStorage.setItem(STREAM_STORAGE_KEY, stream);
      return;
    }
    const stored = window.localStorage.getItem(STREAM_STORAGE_KEY);
    if (stored && stored !== stream && (stored === "rnd" || stored === "all")) {
      // Redirect so the URL matches what the user will see.
      const qs = new URLSearchParams(searchParams.toString());
      qs.set("stream", stored);
      router.replace(`${pathname}?${qs.toString()}`);
    }
  }, [pathname, router, searchParams, stream]);

  function chooseStream(next: Stream) {
    if (next === stream) return;
    const qs = new URLSearchParams(searchParams.toString());
    qs.set("stream", next);
    router.replace(`${pathname}?${qs.toString()}`);
    // Kick the server component to re-render with the new
    // searchParams so `initialPage` + `initialStream` refresh in
    // lockstep. Without this, Next.js may serve the cached RSC
    // from the previous tab, and the ledger's `boundInitialPage`
    // branch has to compensate.
    router.refresh();
  }

  const fetchPage = useMemo(() => buildFetchPage(stream), [stream]);

  // The server-rendered `initialPage` matches whichever stream the URL
  // carried at request time (see page.tsx). When the user later flips
  // tabs the URL replaces, the ledger remounts under a new `key`, and
  // this component runs fresh with the new `initialStream` matching
  // the new URL — no manual reconciliation needed.
  const boundInitialPage: PageResult<ManufacturingOrderSummary> =
    stream === initialStream
      ? { items: initialPage.items, next_cursor: initialPage.next_cursor }
      : { items: [], next_cursor: null };

  const filters = useMemo<FilterDef[]>(
    () => [STATUS_FILTER, ...(locationFilters ?? [])],
    [locationFilters],
  );

  const columns = useMemo<DataTableColumn<ManufacturingOrderSummary>[]>(
    () => [
      {
        id: "code",
        header: "MO",
        widthClassName: "w-32",
        filterField: "code",
        filterKind: "text",
        filterPlaceholder: "MO00001…",
        group: "Identity",
        description: "Auto-numbered MO code (MO00001, …).",
        cell: (m) => (
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs font-semibold">
              {m.code ?? `#${m.id}`}
            </span>
            {isRndProjectType(m.project_type) && (
              <span
                title="R&D — trial or sample MO. Books R&D-tagged lots only."
                className="inline-flex items-center gap-0.5 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-violet-700 dark:text-violet-300"
              >
                <FlaskConical className="size-2.5" />
                R&D
              </span>
            )}
          </div>
        ),
      },
      {
        id: "status",
        header: "Status",
        widthClassName: "w-32",
        sortField: "status",
        filterField: "status",
        filterKind: "select",
        filterOptions: STATUS_OPTIONS,
        group: "Status",
        description: "MO lifecycle — draft → approved → scheduled → in progress → completed.",
        cell: (m) => (
          <Badge tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Badge>
        ),
      },
      {
        id: "product",
        header: "Product",
        widthClassName: "min-w-[16rem]",
        filterField: "product",
        filterKind: "text",
        filterPlaceholder: "Item name or SKU…",
        group: "Identity",
        description: "Item being manufactured. Filter by name or SKU.",
        cell: (m) =>
          m.item ? (
            <Link
              href={`/production/items/${m.item.uuid}`}
              onClick={(e) => e.stopPropagation()}
              className="block min-w-0 space-y-0.5 group"
            >
              <p className="truncate text-sm underline-offset-2 group-hover:underline">
                {m.item.name}
              </p>
              {m.item.code && (
                <p className="font-mono text-[10px] text-muted-foreground">
                  {m.item.code}
                </p>
              )}
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "quantity",
        header: "Qty",
        widthClassName: "w-24",
        align: "right",
        sortField: "quantity",
        filterField: "quantity",
        filterKind: "number-range",
        group: "Amounts",
        description: "Planned production quantity.",
        cell: (m) => (
          <span className="font-mono text-xs">
            {formatCompanyNumber(m.quantity, prefs)}
          </span>
        ),
      },
      {
        id: "site",
        header: "Site",
        widthClassName: "min-w-[12rem]",
        filterField: "site",
        filterKind: "text",
        filterPlaceholder: "Site name…",
        group: "Location",
        description: "Production site (warehouse) this MO runs at. Filter by name.",
        cell: (m) =>
          m.warehouse ? (
            <span className="truncate text-xs text-muted-foreground">
              {m.warehouse.name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "start_at",
        header: "Scheduled",
        widthClassName: "w-32",
        group: "Dates",
        description: "Planned start (earliest step start).",
        cell: (m) => (
          <span className="text-xs text-muted-foreground">
            {m.start_at ? formatCompanyDate(m.start_at, prefs) : "—"}
          </span>
        ),
      },
      {
        id: "finish_at",
        header: "Finishes",
        widthClassName: "w-32",
        group: "Dates",
        description: "Planned finish (latest step finish).",
        cell: (m) => (
          <span className="text-xs text-muted-foreground">
            {m.finish_at ? formatCompanyDate(m.finish_at, prefs) : "—"}
          </span>
        ),
      },
      {
        id: "assigned_to",
        header: "Assigned",
        widthClassName: "min-w-[10rem]",
        group: "Identity",
        description: "Operator/planner owning this MO.",
        cell: (m) =>
          m.assigned_to ? (
            <span className="truncate text-xs">{m.assigned_to.name}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      // ---- defaultHidden columns below ----
      {
        id: "revision",
        header: "Revision",
        widthClassName: "w-20",
        defaultHidden: true,
        group: "Identity",
        description: "MO revision label (V00, V01, …).",
        cell: (m) => (
          <span className="font-mono text-xs text-muted-foreground">
            {m.revision}
          </span>
        ),
      },
      {
        id: "bom",
        header: "BOM",
        widthClassName: "min-w-[12rem]",
        defaultHidden: true,
        filterField: "bom",
        filterKind: "text",
        filterPlaceholder: "BOM name…",
        group: "Identity",
        description: "Bill of materials driving component consumption. Filter by BOM name.",
        cell: (m) =>
          m.bom ? (
            <span className="truncate text-xs text-muted-foreground">
              {m.bom.name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "item_code",
        header: "Item code",
        widthClassName: "w-24",
        defaultHidden: true,
        group: "Identity",
        description: "Auto-numbered item code for the produced item.",
        cell: (m) =>
          m.item?.code ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {m.item.code}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "due_date",
        header: "Due",
        widthClassName: "w-28",
        defaultHidden: true,
        sortField: "due_date",
        filterField: "due_date",
        filterKind: "date-range",
        group: "Dates",
        description: "Customer-facing due date (may drive scheduling priority).",
        cell: (m) =>
          m.due_date ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(m.due_date, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "prepared_at",
        header: "Prepared",
        widthClassName: "w-32",
        defaultHidden: true,
        filterField: "prepared_at",
        filterKind: "date-range",
        group: "Dates",
        description: "1st signature (planner) timestamp.",
        cell: (m) =>
          m.prepared_at ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(m.prepared_at, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "approved_at",
        header: "Approved",
        widthClassName: "w-32",
        defaultHidden: true,
        filterField: "approved_at",
        filterKind: "date-range",
        group: "Dates",
        description: "2nd signature (scientist) timestamp — MO is committed after this.",
        cell: (m) =>
          m.approved_at ? (
            <span className="text-xs text-muted-foreground">
              {formatCompanyDate(m.approved_at, prefs)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "broken_bookings",
        header: "Broken",
        align: "right",
        widthClassName: "w-20",
        defaultHidden: true,
        group: "Compliance",
        description: "Bookings whose lot fell out of `available` (broken plan).",
        cell: (m) => (
          <span
            className={
              m.broken_bookings_count > 0
                ? "text-sm font-semibold text-destructive"
                : "text-xs text-muted-foreground/50"
            }
          >
            {m.broken_bookings_count}
          </span>
        ),
      },
      {
        id: "under_booked",
        header: "Under-booked",
        align: "right",
        widthClassName: "w-24",
        defaultHidden: true,
        group: "Compliance",
        description: "BOM lines not fully covered by bookings.",
        cell: (m) => (
          <span
            className={
              m.under_booked_count > 0
                ? "text-sm font-semibold text-amber-700 dark:text-amber-400"
                : "text-xs text-muted-foreground/50"
            }
          >
            {m.under_booked_count}
          </span>
        ),
      },
      {
        id: "inserted_at",
        header: "Created",
        widthClassName: "w-32",
        defaultHidden: true,
        sortField: "inserted_at",
        filterField: "inserted_at",
        filterKind: "date-range",
        group: "Meta",
        description: "When this MO was created.",
        cell: (m) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(m.inserted_at, prefs)}
          </span>
        ),
      },
      {
        id: "updated_at",
        header: "Updated",
        widthClassName: "w-32",
        defaultHidden: true,
        sortField: "updated_at",
        filterField: "updated_at",
        filterKind: "date-range",
        group: "Meta",
        description: "When this MO was last modified.",
        cell: (m) => (
          <span className="text-xs text-muted-foreground">
            {formatCompanyDate(m.updated_at, prefs)}
          </span>
        ),
      },
    ],
    [prefs],
  );

  return (
    <div className="space-y-3">
      <StreamTabStrip stream={stream} onChange={chooseStream} />
      <DataTable<ManufacturingOrderSummary>
        // `key` forces a full remount when the stream flips so any
        // in-flight cursors / persisted column filters from the old
        // stream don't leak in.
        key={stream}
        tableId={`production-manufacturing-orders-${stream}`}
        realtimeEntity="manufacturing-order"
        columns={columns}
        rowKey={(m) => String(m.id)}
        fetchPage={fetchPage}
        initialPage={boundInitialPage}
        defaultSort={DEFAULT_SORT}
        filters={filters}
        searchPlaceholder="Search by revision or notes…"
        // Native-anchor row navigation. Each cell wraps its content
        // in a `<Link>` overlay pointing at the MO detail. Nested
        // links (product cell → item) paint above via z-10 and win
        // their own click. Same pattern as the PO ledger fix from
        // yesterday — no JS onClick racing with the item link.
        rowHref={(m) => `/production/manufacturing-orders/${m.uuid}`}
        renderMobileCard={(m) => (
          <div className="space-y-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {m.item?.name ?? m.code}
                </p>
                <p className="flex items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground">
                  {m.code ?? `#${m.id}`}
                  {isRndProjectType(m.project_type) && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-violet-700 dark:text-violet-300">
                      <FlaskConical className="size-2.5" />
                      R&D
                    </span>
                  )}
                </p>
              </div>
              <Badge tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {formatCompanyNumber(m.quantity, prefs)}{" "}
              {m.item?.stock_uom?.symbol ?? "each"} · {m.warehouse?.name}
            </p>
          </div>
        )}
        emptyState={
          <div className="space-y-1">
            <Factory className="mx-auto size-8 text-muted-foreground/40" />
            <p className="text-sm font-medium">No manufacturing orders yet</p>
            <p className="text-xs text-muted-foreground">
              Create the first run for a finished or semi-finished item.
            </p>
          </div>
        }
      />
    </div>
  );
}
