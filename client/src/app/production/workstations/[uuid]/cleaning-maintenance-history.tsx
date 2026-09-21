"use client";

import { useCallback, useMemo, useState } from "react";
import { Loader2, Sparkles, Wrench, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCompanyDate, type FormatPrefs } from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import type {
  WorkstationEventKind,
  WorkstationEventPage,
  WorkstationEventRow,
} from "@/lib/production/audit-events";

type FilterKind = "all" | "cleaning" | "maintenance";

interface Props {
  workstationUuid: string;
  initialItems: WorkstationEventRow[];
  initialCursor: string | null;
  prefs: FormatPrefs | null;
}

function formatClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "—";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${rem}s`;
  return `${s}s`;
}

const KIND_LABEL: Record<WorkstationEventKind, string> = {
  cleaning_completed: "Cleaning · completed",
  cleaning_started: "Cleaning · started",
  maintenance_completed: "Maintenance · completed",
  maintenance_started: "Maintenance · started",
  note: "Note",
};

const KIND_TONE: Record<WorkstationEventKind, string> = {
  cleaning_completed: "bg-amber-500",
  cleaning_started: "bg-amber-300",
  maintenance_completed: "bg-violet-500",
  maintenance_started: "bg-violet-300",
  note: "bg-slate-400",
};

function rowMatchesFilter(row: WorkstationEventRow, filter: FilterKind) {
  if (filter === "all") return true;
  if (filter === "cleaning") return row.kind.startsWith("cleaning");
  if (filter === "maintenance") return row.kind.startsWith("maintenance");
  return true;
}

async function fetchNextPage(
  workstationUuid: string,
  cursor: string,
  kinds: WorkstationEventKind[],
): Promise<WorkstationEventPage> {
  const params = new URLSearchParams({ limit: "20", cursor });
  if (kinds.length > 0) params.set("kind", kinds.join(","));
  const res = await fetch(
    `/api/production/workstations/${encodeURIComponent(workstationUuid)}/events?${params.toString()}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Failed to load history (${res.status})`);
  return (await res.json()) as WorkstationEventPage;
}

/** Paginated cleaning + maintenance history for one workstation.
 *  Renders as a vertical list; each row is a compact audit record
 *  with kind chip, when, who, duration, and (when present) a link
 *  to the form-response checklist evidence.
 *
 *  The filter tabs are client-only so switching between all /
 *  cleaning / maintenance is instantaneous — the initial hydration
 *  gets both kinds, and pagination only refetches under the active
 *  filter. */
export function CleaningMaintenanceHistory({
  workstationUuid,
  initialItems,
  initialCursor,
  prefs: prefsProp,
}: Props) {
  const contextPrefs = useFormatPrefs();
  const prefs = prefsProp ?? contextPrefs;

  const [items, setItems] = useState<WorkstationEventRow[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKind>("all");

  const filtered = useMemo(
    () => items.filter((r) => rowMatchesFilter(r, filter)),
    [items, filter],
  );

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const kinds: WorkstationEventKind[] =
        filter === "cleaning"
          ? ["cleaning_completed", "cleaning_started"]
          : filter === "maintenance"
            ? ["maintenance_completed", "maintenance_started"]
            : [];
      const next = await fetchNextPage(workstationUuid, cursor, kinds);
      setItems((prev) => [...prev, ...next.items]);
      setCursor(next.next_cursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, workstationUuid, filter]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1">
        <FilterTab label="All" active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterTab
          label="Cleaning"
          active={filter === "cleaning"}
          onClick={() => setFilter("cleaning")}
          icon={<Sparkles className="size-3" aria-hidden />}
        />
        <FilterTab
          label="Maintenance"
          active={filter === "maintenance"}
          onClick={() => setFilter("maintenance")}
          icon={<Wrench className="size-3" aria-hidden />}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 py-6 text-center text-xs text-muted-foreground">
          {filter === "all"
            ? "No cleaning or maintenance events recorded yet."
            : `No ${filter} events recorded yet.`}
        </p>
      ) : (
        <ul className="divide-y divide-border/40">
          {filtered.map((row) => (
            <li key={row.id}>
              <HistoryRow row={row} prefs={prefs} />
            </li>
          ))}
        </ul>
      )}

      {cursor !== null && (
        <div className="flex items-center justify-center gap-3 pt-2">
          {error && (
            <span className="text-xs text-red-600 dark:text-red-400">
              {error}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={loadMore}
            disabled={loading}
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-3 animate-spin" aria-hidden />
                Loading…
              </span>
            ) : (
              "Load more"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function FilterTab({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-colors " +
        (active
          ? "bg-foreground text-background"
          : "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground")
      }
    >
      {icon}
      {label}
    </button>
  );
}

function HistoryRow({
  row,
  prefs,
}: {
  row: WorkstationEventRow;
  prefs: FormatPrefs | null;
}) {
  const startedAt = row.started_at ?? row.ended_at ?? row.inserted_at;
  const equipmentName =
    (row.metadata &&
      typeof row.metadata === "object" &&
      (row.metadata as Record<string, unknown>)["equipment_name"]) ||
    null;

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 py-2.5">
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          className={`mt-1 size-2 shrink-0 rounded-full ${KIND_TONE[row.kind]}`}
          aria-hidden
        />
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {KIND_LABEL[row.kind]}
            </span>
            {typeof equipmentName === "string" && equipmentName && (
              <span className="rounded-full bg-muted/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                {String(equipmentName)}
              </span>
            )}
          </div>
          <div className="text-xs">
            <span className="font-medium">
              {row.worker_name || "Unknown operator"}
            </span>
            {row.reason && (
              <span className="ml-2 text-muted-foreground">— {row.reason}</span>
            )}
          </div>
          {row.form_response_uuid && (
            <div className="text-[10px] text-muted-foreground/70">
              <span className="inline-flex items-center gap-1">
                <ChevronRight className="size-3" aria-hidden />
                Checklist evidence · {row.form_response_uuid.slice(0, 8)}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right text-[11px]">
        <div className="text-muted-foreground">
          {formatCompanyDate(startedAt, prefs)}
          {row.started_at && (
            <>
              {" · "}
              <span className="font-mono tabular-nums">
                {formatClock(row.started_at)}
              </span>
            </>
          )}
        </div>
        <div className="mt-0.5 font-mono tabular-nums">
          {formatDuration(row.duration_seconds)}
        </div>
      </div>
    </div>
  );
}
