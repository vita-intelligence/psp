import {
  ArrowRight,
  ClipboardCheck,
  Cog,
  MoveRight,
  PackagePlus,
  PowerOff,
  Trash2,
  UserPlus,
  Wrench,
} from "lucide-react";
import type { EquipmentEvent } from "@/lib/equipment/types";
import type { CompanyDefaults } from "@/lib/types";
import { formatCompanyDate } from "@/lib/format/company";
import { UserAvatar } from "@/components/users/user-avatar";

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
      <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold">History</h2>
        <p className="text-sm text-muted-foreground">
          Nothing recorded yet. Actions on this unit land here as
          they happen.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-4 flex items-center gap-2">
        <h2 className="text-sm font-semibold">History</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {events.length} event{events.length === 1 ? "" : "s"}
        </span>
      </header>

      <ul className="relative space-y-4 border-l border-border/60 pl-6">
        {events.map((e) => {
          const Icon = KIND_ICON[e.kind] ?? Cog;
          const tone = KIND_TONE[e.kind] ?? DEFAULT_TONE;
          const label = KIND_LABEL[e.kind] ?? e.kind.replace(/_/g, " ");

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
    </section>
  );
}
