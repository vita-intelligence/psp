"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Loader2,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge-mini";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatCompanyDate } from "@/lib/format/company";
import { useEntityChannel } from "@/lib/realtime/use-entity-channel";
import type { CompanyDefaults, OrderWizardPhaseKey } from "@/lib/types";
import type {
  MyTask,
  MyTasksPage,
  UrgencyFilter,
} from "@/lib/my-tasks/types";

interface Props {
  initialPage: MyTasksPage;
  companyDefaults: CompanyDefaults | null;
}

// A short, opinionated set of phase buckets used for the filter chips.
// The wizard emits 12 phase keys; grouping them keeps the chip row
// scannable and matches how operators think about their day.
type PhaseBucketKey = "approval" | "planning" | "production" | "dispatch" | "delivery";

interface PhaseBucket {
  key: PhaseBucketKey;
  label: string;
  /** Phase keys that fall into this bucket. */
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

const URGENCY_CHIPS: {
  key: UrgencyFilter | "all";
  label: string;
  tone: "muted" | "destructive" | "amber" | "emerald";
}[] = [
  { key: "all", label: "All", tone: "muted" },
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

const EMPTY_FILTERS: Filters = { phaseBucket: null, urgency: null, search: "" };

export function MyTasksBoard({ initialPage, companyDefaults }: Props) {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [tasks, setTasks] = useState<MyTask[]>(initialPage.tasks);
  const [nextCursor, setNextCursor] = useState<string | null>(
    initialPage.next_cursor,
  );
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // The filter set drives every fetch. On any filter change we throw
  // away the current tasks + cursor and re-fetch from scratch.
  const activeQuery = useMemo(() => {
    return {
      bucketKey: filters.phaseBucket,
      urgency: filters.urgency,
      search: debouncedSearch,
    };
  }, [filters.phaseBucket, filters.urgency, debouncedSearch]);

  // Debounce search input so we don't fetch on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search.trim()), 250);
    return () => clearTimeout(t);
  }, [filters.search]);

  // Fetch on filter changes. The API returns a *filtered* page — no
  // client-side filtering needed. This keeps the FE dumb.
  const isInitial = useRef(true);
  useEffect(() => {
    if (isInitial.current) {
      isInitial.current = false;
      return;
    }
    let cancelled = false;
    async function run() {
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
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [activeQuery]);

  // Realtime — refresh when any CO changes. Debounced in the hook.
  const refetchCurrent = useCallback(async () => {
    setLoading(true);
    try {
      const page = await fetchTasks({
        phase: activeQuery.bucketKey,
        urgency: activeQuery.urgency,
        search: activeQuery.search,
      });
      setTasks(page.tasks);
      setNextCursor(page.next_cursor);
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

  return (
    <div className="space-y-4">
      {/* Filter chips + search */}
      <div className="flex flex-wrap items-center gap-2">
        {URGENCY_CHIPS.map((chip) => {
          const active =
            (chip.key === "all" && filters.urgency === null) ||
            chip.key === filters.urgency;
          return (
            <Chip
              key={chip.key}
              label={chip.label}
              tone={chip.tone}
              active={active}
              onClick={() =>
                setFilters((prev) => ({
                  ...prev,
                  urgency: chip.key === "all" ? null : chip.key,
                }))
              }
            />
          );
        })}

        <span className="mx-1 h-4 w-px bg-border" />

        {PHASE_BUCKETS.map((bucket) => (
          <Chip
            key={bucket.key}
            label={bucket.label}
            tone="muted"
            active={filters.phaseBucket === bucket.key}
            onClick={() =>
              setFilters((prev) => ({
                ...prev,
                phaseBucket:
                  prev.phaseBucket === bucket.key ? null : bucket.key,
              }))
            }
          />
        ))}

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={filters.search}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, search: e.target.value }))
              }
              placeholder="Search CO or customer…"
              className="h-8 w-56 pl-7 text-xs"
            />
          </div>
          {anyFilter && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="text-xs"
            >
              <X className="mr-1 size-3" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="relative">
        {loading && (
          <div className="absolute inset-x-0 -top-1 z-10 h-0.5 overflow-hidden rounded-full">
            <div className="h-full w-1/3 animate-[progress-slide_1s_ease-in-out_infinite] rounded-full bg-brand" />
          </div>
        )}

        {tasks.length === 0 && !loading ? (
          <EmptyState anyFilter={anyFilter} />
        ) : (
          <ul className="space-y-2">
            {tasks.map((task) => (
              <li key={task.id}>
                <TaskRow
                  task={task}
                  companyDefaults={companyDefaults}
                  onExecuted={() => router.refresh()}
                />
              </li>
            ))}
          </ul>
        )}

        {nextCursor && (
          <div className="flex justify-center py-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
              Load more
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({
  label,
  tone,
  active,
  onClick,
}: {
  label: string;
  tone: "muted" | "destructive" | "amber" | "emerald";
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
        active
          ? tone === "destructive"
            ? "border-destructive/50 bg-destructive/10 text-destructive"
            : tone === "amber"
              ? "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200"
              : tone === "emerald"
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                : "border-foreground/40 bg-foreground/10 text-foreground"
          : "border-border/60 bg-background text-muted-foreground hover:bg-muted/40",
      )}
    >
      {label}
    </button>
  );
}

function EmptyState({ anyFilter }: { anyFilter: boolean }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <Sparkles className="size-6 text-emerald-500" />
        <p className="text-sm font-semibold">
          {anyFilter ? "No tasks match those filters." : "Nothing waiting on you."}
        </p>
        <p className="max-w-md text-xs text-muted-foreground">
          {anyFilter
            ? "Clear the filters to see everything you're personally on the hook for."
            : "When a project needs a sign-off, an MO created, a PO raised, a release approved, shipment paperwork filled, or a POD logged — and you personally have the permission and no segregation-of-duties block — it will show up here."}
        </p>
      </CardContent>
    </Card>
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
        return;
    }
  }

  const primaryLabel = cta?.label ?? "Open project";
  const dueLabel = task.due_date
    ? formatCompanyDate(task.due_date, companyDefaults)
    : "No due date";

  return (
    <Card
      className={cn(
        "border-border/60 transition-colors",
        urgencyTone === "destructive" && "border-destructive/40 bg-destructive/[0.02]",
        urgencyTone === "amber" && "border-amber-500/40 bg-amber-500/[0.02]",
      )}
    >
      <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Link
              href={`/projects/${encodeURIComponent(task.co_uuid)}`}
              className="inline-flex items-center gap-1 font-mono font-medium text-foreground hover:underline"
            >
              <ClipboardList className="size-3" />
              {task.co_code ?? "CO"}
            </Link>
            {task.customer_name && (
              <span className="inline-flex items-center gap-1">
                <Building2 className="size-3" />
                <span className="truncate">{task.customer_name}</span>
              </span>
            )}
            <Badge tone="muted">{task.phase_label}</Badge>
            <span
              className={cn(
                "inline-flex items-center gap-1",
                urgencyTone === "destructive" && "text-destructive",
                urgencyTone === "amber" &&
                  "text-amber-700 dark:text-amber-300",
              )}
            >
              {urgencyTone === "destructive" ? (
                <AlertTriangle className="size-3" />
              ) : urgencyTone === "amber" ? (
                <CalendarClock className="size-3" />
              ) : (
                <CheckCircle2 className="size-3" />
              )}
              {dueLabel}
            </span>
          </div>

          <p className="text-sm font-medium">{task.title}</p>
          {task.detail && (
            <p className="text-xs text-muted-foreground">{task.detail}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={onPrimary}
            disabled={pending}
          >
            {pending && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            {primaryLabel}
            {cta?.kind === "link" ? (
              <ExternalLink className="ml-1 size-3.5" />
            ) : (
              <ArrowRight className="ml-1 size-3.5" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

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
