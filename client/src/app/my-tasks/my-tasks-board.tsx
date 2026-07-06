"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarClock,
  ClipboardList,
  ExternalLink,
  Filter,
  ListChecks,
  Loader2,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatCompanyDate } from "@/lib/format/company";
import { useEntityChannel } from "@/lib/realtime/use-entity-channel";
import type { CompanyDefaults, OrderWizardPhaseKey } from "@/lib/types";
import type {
  MyTask,
  MyTasksCount,
  MyTasksPage,
  UrgencyFilter,
} from "@/lib/my-tasks/types";

interface Props {
  initialPage: MyTasksPage;
  companyDefaults: CompanyDefaults | null;
}

// =============================================================================
// Filter model — priority buckets (by due-date) + phase buckets (by workflow
// segment). Kept tight so the sidebar stays scannable.
// =============================================================================

type PhaseBucketKey =
  | "approval"
  | "planning"
  | "production"
  | "dispatch"
  | "delivery";

interface PhaseBucket {
  key: PhaseBucketKey;
  label: string;
  phases: OrderWizardPhaseKey[];
}

const PHASE_BUCKETS: PhaseBucket[] = [
  { key: "approval", label: "Approvals", phases: ["setup", "approval"] },
  {
    key: "planning",
    label: "Production planning",
    phases: ["production_planning", "awaiting_ingredients"],
  },
  {
    key: "production",
    label: "Production",
    phases: [
      "in_production",
      "closeout",
      "final_release",
      "awaiting_routing",
    ],
  },
  {
    key: "dispatch",
    label: "Dispatch",
    phases: ["ready_to_dispatch", "awaiting_pickup"],
  },
  {
    key: "delivery",
    label: "Delivery & invoicing",
    phases: ["dispatched", "delivered"],
  },
];

interface PriorityDef {
  key: UrgencyFilter | null; // null = "All"
  label: string;
  tone: "destructive" | "amber" | "muted";
}

const PRIORITY_DEFS: PriorityDef[] = [
  { key: null, label: "All", tone: "muted" },
  { key: "overdue", label: "Overdue", tone: "destructive" },
  { key: "this_week", label: "This week", tone: "amber" },
  { key: "later", label: "Later", tone: "muted" },
  { key: "no_date", label: "No due date", tone: "muted" },
];

interface Filters {
  phaseBucket: PhaseBucketKey | null;
  urgency: UrgencyFilter | null;
  search: string;
}

const EMPTY_FILTERS: Filters = {
  phaseBucket: null,
  urgency: null,
  search: "",
};

// =============================================================================
// Component
// =============================================================================

export function MyTasksBoard({ initialPage, companyDefaults }: Props) {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [tasks, setTasks] = useState<MyTask[]>(initialPage.tasks);
  const [nextCursor, setNextCursor] = useState<string | null>(
    initialPage.next_cursor,
  );
  const [counts, setCounts] = useState<MyTasksCount | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const activeQuery = useMemo(
    () => ({
      bucketKey: filters.phaseBucket,
      urgency: filters.urgency,
      search: debouncedSearch,
    }),
    [filters.phaseBucket, filters.urgency, debouncedSearch],
  );

  // Search debounce — 250 ms keeps the request rate sane.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search.trim()), 250);
    return () => clearTimeout(t);
  }, [filters.search]);

  // First fetch happens on the server (`initialPage`); after that the
  // client owns the data. We fetch on every filter change and on every
  // CO broadcast.
  const isInitial = useRef(true);
  useEffect(() => {
    if (isInitial.current) {
      isInitial.current = false;
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const page = await fetchTasks({
          phase: activeQuery.bucketKey,
          urgency: activeQuery.urgency,
          search: activeQuery.search,
        });
        if (!cancelled) {
          setTasks(page.tasks);
          setNextCursor(page.next_cursor);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeQuery]);

  // Counts drive the filter chip badges — refresh on mount + on CO
  // broadcasts. Separate endpoint keeps it cheap.
  useEffect(() => {
    void refreshCounts().then(setCounts);
  }, []);

  const refetchCurrent = useCallback(async () => {
    setLoading(true);
    try {
      const [page, freshCounts] = await Promise.all([
        fetchTasks({
          phase: activeQuery.bucketKey,
          urgency: activeQuery.urgency,
          search: activeQuery.search,
        }),
        refreshCounts(),
      ]);
      setTasks(page.tasks);
      setNextCursor(page.next_cursor);
      setCounts(freshCounts);
    } finally {
      setLoading(false);
    }
  }, [activeQuery]);

  useEntityChannel({
    entity: "customer-order",
    onEvent: () => void refetchCurrent(),
  });

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchTasks({
        cursor: nextCursor,
        phase: activeQuery.bucketKey,
        urgency: activeQuery.urgency,
        search: activeQuery.search,
      });
      setTasks((prev) => [...prev, ...page.tasks]);
      setNextCursor(page.next_cursor);
    } finally {
      setLoadingMore(false);
    }
  }

  const anyFilter =
    filters.phaseBucket !== null ||
    filters.urgency !== null ||
    filters.search.length > 0;

  const total = counts?.total ?? tasks.length;
  const overdueCount = counts?.overdue ?? 0;

  // Group tasks by urgency for section headers — only when no urgency
  // filter is active, otherwise the section header would be redundant.
  const grouped = useMemo(() => groupByUrgency(tasks, !!filters.urgency), [
    tasks,
    filters.urgency,
  ]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
      {/* --------------------- Left column: filters --------------------- */}
      <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
        {/* Search box */}
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={filters.search}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, search: e.target.value }))
            }
            placeholder="Search CO or customer…"
            className="h-9 pl-8 text-xs"
          />
        </div>

        {/* Priority */}
        <FilterGroup
          title="Priority"
          icon={AlertTriangle}
          items={PRIORITY_DEFS.map((p) => ({
            key: p.key ?? "all",
            label: p.label,
            tone: p.tone,
            count: priorityCount(counts, p.key),
            active:
              (p.key === null && filters.urgency === null) ||
              p.key === filters.urgency,
            onClick: () =>
              setFilters((prev) => ({
                ...prev,
                urgency: p.key === null ? null : p.key,
              })),
          }))}
        />

        {/* Phase */}
        <FilterGroup
          title="Phase"
          icon={ListChecks}
          items={[
            {
              key: "all-phase",
              label: "All phases",
              tone: "muted",
              count: total,
              active: filters.phaseBucket === null,
              onClick: () =>
                setFilters((prev) => ({ ...prev, phaseBucket: null })),
            },
            ...PHASE_BUCKETS.map((b) => ({
              key: b.key,
              label: b.label,
              tone: "muted" as const,
              count: bucketCount(counts, b),
              active: filters.phaseBucket === b.key,
              onClick: () =>
                setFilters((prev) => ({
                  ...prev,
                  phaseBucket: prev.phaseBucket === b.key ? null : b.key,
                })),
            })),
          ]}
        />

        {anyFilter && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="h-8 w-full justify-start px-2 text-xs text-muted-foreground"
          >
            <X className="mr-1.5 size-3" />
            Clear all filters
          </Button>
        )}
      </aside>

      {/* --------------------- Right column: list --------------------- */}
      <section className="min-w-0 space-y-4">
        <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border/60 pb-3">
          <div className="flex items-baseline gap-3">
            <h1 className="text-xl font-semibold tracking-tight">My tasks</h1>
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{total}</span>{" "}
              {total === 1 ? "task" : "tasks"}
              {overdueCount > 0 && (
                <>
                  {" · "}
                  <span className="font-medium text-destructive">
                    {overdueCount} overdue
                  </span>
                </>
              )}
            </p>
          </div>
          {loading && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Refreshing…
            </span>
          )}
        </header>

        {tasks.length === 0 && !loading ? (
          <EmptyState anyFilter={anyFilter} />
        ) : (
          <div className="space-y-6">
            {grouped.map((section) =>
              section.tasks.length === 0 ? null : (
                <SectionBlock
                  key={section.key}
                  section={section}
                  companyDefaults={companyDefaults}
                  onExecuted={() => router.refresh()}
                />
              ),
            )}
          </div>
        )}

        {nextCursor && (
          <div className="flex justify-center pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore && (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              )}
              Load more
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

// =============================================================================
// Subcomponents
// =============================================================================

interface FilterGroupItem {
  key: string;
  label: string;
  tone: "destructive" | "amber" | "muted";
  count: number;
  active: boolean;
  onClick: () => void;
}

function FilterGroup({
  title,
  icon: Icon,
  items,
}: {
  title: string;
  icon: typeof AlertTriangle;
  items: FilterGroupItem[];
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 px-1">
        <Icon className="size-3 text-muted-foreground" />
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
      </div>
      <ul className="space-y-0.5">
        {items.map((it) => (
          <li key={it.key}>
            <button
              type="button"
              onClick={it.onClick}
              className={cn(
                "group flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                it.active
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <span className="flex items-center gap-2 truncate">
                <span
                  aria-hidden
                  className={cn(
                    "inline-block size-1.5 rounded-full",
                    it.tone === "destructive" && "bg-destructive",
                    it.tone === "amber" && "bg-amber-500",
                    it.tone === "muted" &&
                      (it.active ? "bg-foreground/60" : "bg-muted-foreground/50"),
                  )}
                />
                <span className="truncate">{it.label}</span>
              </span>
              <span
                className={cn(
                  "min-w-[1.5rem] rounded px-1 text-center font-mono text-[10px]",
                  it.active
                    ? "bg-background text-foreground"
                    : "text-muted-foreground/70",
                )}
              >
                {it.count}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface Section {
  key: "overdue" | "this_week" | "later" | "no_date" | "flat";
  label: string | null;
  tone: "destructive" | "amber" | "muted";
  tasks: MyTask[];
}

function SectionBlock({
  section,
  companyDefaults,
  onExecuted,
}: {
  section: Section;
  companyDefaults: CompanyDefaults | null;
  onExecuted: () => void;
}) {
  return (
    <section className="space-y-2">
      {section.label && (
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn(
              "inline-block size-1.5 rounded-full",
              section.tone === "destructive" && "bg-destructive",
              section.tone === "amber" && "bg-amber-500",
              section.tone === "muted" && "bg-muted-foreground/50",
            )}
          />
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {section.label}
          </h3>
          <span className="text-[11px] font-mono text-muted-foreground/70">
            {section.tasks.length}
          </span>
        </div>
      )}
      <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 bg-background">
        {section.tasks.map((task) => (
          <li key={task.id}>
            <TaskRow
              task={task}
              companyDefaults={companyDefaults}
              onExecuted={onExecuted}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function TaskRow({
  task,
  companyDefaults,
  onExecuted,
}: {
  task: MyTask;
  companyDefaults: CompanyDefaults | null;
  onExecuted: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const cta = task.cta;
  const urgencyTone = urgencyToneFor(task.due_date);

  function onPrimary() {
    if (!cta) return;
    switch (cta.kind) {
      case "link":
        if (cta.href) router.push(cta.href);
        return;
      case "scroll_to":
        router.push(`/projects/${encodeURIComponent(task.co_uuid)}`);
        return;
      case "send_to_device":
        if (cta.href) {
          startTransition(async () => {
            const res = await fetch(cta.href!, { method: "POST" });
            if (!res.ok) {
              const body = (await res.json().catch(() => ({}))) as {
                detail?: string;
              };
              toast.error(body.detail ?? "Couldn't reach your phone.");
              return;
            }
            toast.success("Sent to your phone.");
            onExecuted();
          });
        }
        return;
      case "action":
      default:
        router.push(`/projects/${encodeURIComponent(task.co_uuid)}`);
    }
  }

  const primaryLabel = cta?.label ?? "Open project";
  const dueLabel = task.due_date
    ? formatCompanyDate(task.due_date, companyDefaults)
    : "No due date";

  return (
    <div className="group flex items-stretch gap-3 hover:bg-muted/30">
      {/* Left urgency stripe — solid destructive/amber accent lets you
          scan overdue tasks from across the room without the whole
          card getting shouty. */}
      <span
        aria-hidden
        className={cn(
          "w-0.5 shrink-0 self-stretch",
          urgencyTone === "destructive" && "bg-destructive",
          urgencyTone === "amber" && "bg-amber-500",
          urgencyTone === "muted" && "bg-transparent",
        )}
      />

      <div className="flex-1 py-3 pr-3 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <Link
                href={`/projects/${encodeURIComponent(task.co_uuid)}`}
                className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-foreground hover:underline"
              >
                <ClipboardList className="size-3" />
                {task.co_code ?? "CO"}
              </Link>
              {task.customer_name && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="inline-flex items-center gap-1 truncate">
                    <Building2 className="size-3" />
                    <span className="truncate">{task.customer_name}</span>
                  </span>
                </>
              )}
              <span className="text-muted-foreground/40">·</span>
              <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                {task.phase_label}
              </span>
              <span className="text-muted-foreground/40">·</span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 font-medium",
                  urgencyTone === "destructive" && "text-destructive",
                  urgencyTone === "amber" &&
                    "text-amber-700 dark:text-amber-300",
                )}
              >
                <CalendarClock className="size-3" />
                {dueLabel}
              </span>
            </div>

            {/* Title + detail */}
            <p className="text-sm font-medium leading-snug text-foreground">
              {task.title}
            </p>
            {task.detail && (
              <p className="text-xs leading-normal text-muted-foreground line-clamp-2">
                {task.detail}
              </p>
            )}
          </div>

          {/* CTA button — arrow-linkish, not the visual centrepiece */}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onPrimary}
            disabled={pending}
            className="shrink-0 group-hover:bg-background"
          >
            {pending && <Loader2 className="mr-1.5 size-3 animate-spin" />}
            <span className="truncate">{primaryLabel}</span>
            {cta?.kind === "link" ? (
              <ExternalLink className="ml-1 size-3" />
            ) : (
              <ArrowRight className="ml-1 size-3" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ anyFilter }: { anyFilter: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border/60 py-12 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        {anyFilter ? (
          <Filter className="size-4" />
        ) : (
          <Sparkles className="size-4" />
        )}
      </div>
      <p className="text-sm font-medium">
        {anyFilter
          ? "No tasks match those filters."
          : "You're all caught up."}
      </p>
      <p className="max-w-sm text-xs text-muted-foreground">
        {anyFilter
          ? "Try clearing the filters or widening your search."
          : "New tasks show up here as soon as a project needs a sign-off, MO, PO, release, shipment, or POD you're personally responsible for."}
      </p>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function urgencyToneFor(
  dueIso: string | null,
): "destructive" | "amber" | "muted" {
  if (!dueIso) return "muted";
  const at = Date.parse(dueIso);
  if (Number.isNaN(at)) return "muted";
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const weekEnd = todayStart + 7 * 86_400_000;
  if (at < todayStart) return "destructive";
  if (at < weekEnd) return "amber";
  return "muted";
}

function groupByUrgency(tasks: MyTask[], flat: boolean): Section[] {
  if (flat) {
    return [{ key: "flat", label: null, tone: "muted", tasks }];
  }

  const overdue: MyTask[] = [];
  const thisWeek: MyTask[] = [];
  const later: MyTask[] = [];
  const noDate: MyTask[] = [];
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const weekEnd = todayStart + 7 * 86_400_000;

  for (const t of tasks) {
    if (!t.due_date) {
      noDate.push(t);
      continue;
    }
    const at = Date.parse(t.due_date);
    if (Number.isNaN(at)) {
      noDate.push(t);
      continue;
    }
    if (at < todayStart) overdue.push(t);
    else if (at < weekEnd) thisWeek.push(t);
    else later.push(t);
  }

  return [
    { key: "overdue", label: "Overdue", tone: "destructive", tasks: overdue },
    { key: "this_week", label: "This week", tone: "amber", tasks: thisWeek },
    { key: "later", label: "Later", tone: "muted", tasks: later },
    { key: "no_date", label: "No due date", tone: "muted", tasks: noDate },
  ];
}

function priorityCount(
  counts: MyTasksCount | null,
  key: UrgencyFilter | null,
): number {
  if (!counts) return 0;
  switch (key) {
    case null:
      return counts.total;
    case "overdue":
      return counts.overdue;
    case "this_week":
      return counts.this_week;
    case "later":
      return counts.later;
    case "no_date":
      return counts.no_date;
    default:
      return 0;
  }
}

function bucketCount(counts: MyTasksCount | null, bucket: PhaseBucket): number {
  if (!counts) return 0;
  return bucket.phases.reduce(
    (sum, phase) => sum + (counts.by_phase[phase] ?? 0),
    0,
  );
}

async function fetchTasks(opts: {
  cursor?: string;
  phase?: string | null;
  urgency?: UrgencyFilter | null;
  search?: string | null;
}): Promise<MyTasksPage> {
  const qs = new URLSearchParams();
  qs.set("limit", "50");
  if (opts.cursor) qs.set("cursor", opts.cursor);
  if (opts.phase) qs.set("phase", opts.phase);
  if (opts.urgency) qs.set("urgency", opts.urgency);
  if (opts.search) qs.set("search", opts.search);
  const res = await fetch(`/api/my-tasks?${qs}`, { cache: "no-store" });
  if (!res.ok) return { tasks: [], next_cursor: null };
  return (await res.json()) as MyTasksPage;
}

async function refreshCounts(): Promise<MyTasksCount | null> {
  try {
    const res = await fetch("/api/my-tasks/count", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as MyTasksCount;
  } catch {
    return null;
  }
}
