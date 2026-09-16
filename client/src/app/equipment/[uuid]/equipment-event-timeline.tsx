import {
  AlertOctagon,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Cog,
  MoveRight,
  PackagePlus,
  PowerOff,
  ShieldCheck,
  Trash2,
  UserPlus,
  Wrench,
} from "lucide-react";
import type { EquipmentEvent } from "@/lib/equipment/types";
import type { CompanyDefaults } from "@/lib/types";
import { formatCompanyDate } from "@/lib/format/company";
import { UserAvatar } from "@/components/users/user-avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const KIND_ICON: Record<string, typeof Cog> = {
  received: PackagePlus,
  in_service: ClipboardCheck,
  maintenance_started: Wrench,
  maintenance_completed: ClipboardCheck,
  calibrated: ClipboardCheck,
  moved: MoveRight,
  assigned: UserPlus,
  unassigned: UserPlus,
  retired: PowerOff,
  disposed: Trash2,
  note: ArrowRight,
};

const KIND_LABEL: Record<string, string> = {
  received: "Received",
  in_service: "Put in service",
  maintenance_started: "Started maintenance",
  maintenance_completed: "Completed maintenance",
  calibrated: "Calibrated",
  moved: "Moved",
  assigned: "Assigned",
  unassigned: "Unassigned",
  retired: "Retired",
  disposed: "Disposed",
  canceled: "Cancelled",
  note: "Note",
};

const KIND_TONE: Record<string, { bg: string; icon: string; chip: string }> = {
  received: {
    bg: "bg-indigo-500/15",
    icon: "text-indigo-700 dark:text-indigo-400",
    chip: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
  },
  in_service: {
    bg: "bg-emerald-500/15",
    icon: "text-emerald-700 dark:text-emerald-400",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  maintenance_started: {
    bg: "bg-amber-500/15",
    icon: "text-amber-700 dark:text-amber-400",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  maintenance_completed: {
    bg: "bg-emerald-500/15",
    icon: "text-emerald-700 dark:text-emerald-400",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  calibrated: {
    bg: "bg-sky-500/15",
    icon: "text-sky-700 dark:text-sky-400",
    chip: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  },
  moved: {
    bg: "bg-sky-500/15",
    icon: "text-sky-700 dark:text-sky-400",
    chip: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  },
  retired: {
    bg: "bg-zinc-500/15",
    icon: "text-zinc-700 dark:text-zinc-400",
    chip: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400",
  },
  disposed: {
    bg: "bg-red-500/15",
    icon: "text-red-700 dark:text-red-400",
    chip: "bg-red-500/10 text-red-700 dark:text-red-400",
  },
};

const DEFAULT_TONE = {
  bg: "bg-muted",
  icon: "text-muted-foreground",
  chip: "bg-muted text-muted-foreground",
};

// A `note` kind is universally allowed by the lifecycle state
// machine, so the maintenance / repair contexts stash the actual
// semantic in metadata.event_semantic. The UI unpacks it here so
// timeline reads read like the actions they represent.
const SEMANTIC_ICON: Record<string, typeof Cog> = {
  maintenance_completed: ClipboardCheck,
  calibration_completed: ShieldCheck,
  breakdown_reported: AlertOctagon,
  breakdown_resolved: CheckCircle2,
};

const SEMANTIC_LABEL: Record<string, string> = {
  maintenance_completed: "Maintenance completed",
  calibration_completed: "Calibration completed",
  breakdown_reported: "Breakdown reported",
  breakdown_resolved: "Breakdown resolved",
};

const SEMANTIC_TONE: Record<
  string,
  { bg: string; icon: string; chip: string }
> = {
  maintenance_completed: {
    bg: "bg-emerald-500/15",
    icon: "text-emerald-700 dark:text-emerald-400",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  calibration_completed: {
    bg: "bg-sky-500/15",
    icon: "text-sky-700 dark:text-sky-400",
    chip: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  },
  breakdown_reported: {
    bg: "bg-red-500/15",
    icon: "text-red-700 dark:text-red-400",
    chip: "bg-red-500/10 text-red-700 dark:text-red-400",
  },
  breakdown_resolved: {
    bg: "bg-emerald-500/15",
    icon: "text-emerald-700 dark:text-emerald-400",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
};

function readSemantic(e: {
  metadata: Record<string, unknown> | null | undefined;
}): string | null {
  const meta = e.metadata;
  if (!meta || typeof meta !== "object") return null;
  const val = (meta as Record<string, unknown>)["event_semantic"];
  return typeof val === "string" ? val : null;
}

function readStr(meta: Record<string, unknown>, key: string): string | null {
  const val = meta[key];
  return typeof val === "string" && val !== "" ? val : null;
}

function readNum(meta: Record<string, unknown>, key: string): number | null {
  const val = meta[key];
  if (typeof val === "number") return val;
  if (typeof val === "string" && val !== "") {
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function readList(meta: Record<string, unknown>, key: string): unknown[] {
  const val = meta[key];
  return Array.isArray(val) ? val : [];
}

function formatMinutesShort(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
}

function SemanticDetail({
  semantic,
  metadata,
}: {
  semantic: string;
  metadata: Record<string, unknown> | null | undefined;
}) {
  if (!metadata || typeof metadata !== "object") return null;
  const meta = metadata as Record<string, unknown>;

  if (
    semantic === "maintenance_completed" ||
    semantic === "calibration_completed"
  ) {
    const taskName = readStr(meta, "task_name");
    const evidenceCount = readList(meta, "evidence_urls").length;
    return (
      <p className="text-[11px] text-muted-foreground">
        {taskName ? (
          <span>
            <span className="font-medium">Task:</span> {taskName}
          </span>
        ) : null}
        {evidenceCount > 0 ? (
          <span className="ml-2">
            · {evidenceCount} certificate
            {evidenceCount === 1 ? "" : "s"}
          </span>
        ) : null}
      </p>
    );
  }

  if (semantic === "breakdown_resolved") {
    const downtime = readNum(meta, "downtime_minutes");
    const cost = readStr(meta, "repair_cost");
    const currency = readStr(meta, "currency");
    if (downtime == null && !cost) return null;
    return (
      <p className="text-[11px] text-muted-foreground">
        {downtime != null ? (
          <span>
            <span className="font-medium">Downtime:</span>{" "}
            {formatMinutesShort(downtime)}
          </span>
        ) : null}
        {cost ? (
          <span className="ml-2">
            <span className="font-medium">Cost:</span> {cost}
            {currency ? ` ${currency}` : ""}
          </span>
        ) : null}
      </p>
    );
  }

  return null;
}

interface Props {
  events: EquipmentEvent[];
  prefs: CompanyDefaults;
}

/**
 * Append-only lifecycle timeline for an equipment unit. Mirrors the
 * lot movement timeline visually — kind chip, delta, actor, occurred
 * at — so a QC / audit reviewer walking the app doesn't have to learn
 * a new pattern.
 */
export function EquipmentEventTimeline({ events, prefs }: Props) {
  if (events.length === 0) {
    return (
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>History</CardTitle>
          <CardDescription>
            Nothing recorded yet. Lifecycle transitions, maintenance
            completions, and repair events land here as they happen.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle>History</CardTitle>
            <CardDescription>
              Append-only audit trail — every lifecycle transition,
              maintenance completion, and repair event, newest last.
            </CardDescription>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {events.length} event{events.length === 1 ? "" : "s"}
          </span>
        </div>
      </CardHeader>
      <CardContent>
      <ul className="relative space-y-4 border-l border-border/60 pl-6">
        {events.map((e) => {
          // Prefer the semantic hint on `note` events so maintenance
          // / calibration / breakdown rows read distinctly. Falls
          // back to the raw kind for lifecycle events.
          const semantic = e.kind === "note" ? readSemantic(e) : null;
          const semanticIcon = semantic ? SEMANTIC_ICON[semantic] : undefined;
          const semanticTone = semantic ? SEMANTIC_TONE[semantic] : undefined;
          const semanticLabel = semantic
            ? SEMANTIC_LABEL[semantic]
            : undefined;
          const Icon = semanticIcon ?? KIND_ICON[e.kind] ?? Cog;
          const tone = semanticTone ?? KIND_TONE[e.kind] ?? DEFAULT_TONE;
          const label =
            semanticLabel ?? KIND_LABEL[e.kind] ?? e.kind.replace(/_/g, " ");

          return (
            <li key={e.uuid} className="relative">
              <span
                className={
                  "absolute -left-[27px] top-1.5 inline-flex size-6 items-center justify-center rounded-full ring-2 ring-background " +
                  tone.bg
                }
              >
                <Icon className={"size-3.5 " + tone.icon} />
              </span>

              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                        tone.chip
                      }
                    >
                      {label}
                    </span>
                  </div>

                  {e.reason && (
                    <p className="text-[11px] text-muted-foreground">
                      <span className="font-medium">Reason:</span> {e.reason}
                    </p>
                  )}

                  {semantic && (
                    <SemanticDetail
                      semantic={semantic}
                      metadata={e.metadata}
                    />
                  )}

                  {e.assigned_to_user && (
                    <p className="text-[11px] text-muted-foreground">
                      <span className="font-medium">Assigned to:</span>{" "}
                      {e.assigned_to_user.name ?? e.assigned_to_user.email}
                    </p>
                  )}
                </div>

                <div className="min-w-0 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {e.actor && (
                      <UserAvatar
                        name={e.actor.name}
                        email={e.actor.email}
                        avatar={e.actor.avatar}
                        sizeClassName="size-5"
                        fallbackClassName="text-[9px]"
                      />
                    )}
                    <span className="text-xs font-medium">
                      {e.actor?.name ?? (e.actor_kind === "system" ? "System" : "—")}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {formatCompanyDate(e.occurred_at, prefs)}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      </CardContent>
    </Card>
  );
}
