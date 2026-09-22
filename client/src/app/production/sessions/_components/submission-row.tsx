import Link from "next/link";
import {
  CircleAlert,
  ClipboardCheck,
  ClipboardList,
  Cog,
  Factory,
  User,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge-mini";
import type { FormSubmissionRow } from "@/lib/sessions/types";
import { ACTIVITY_KIND_LABELS } from "@/lib/sessions/types";
import { TRIGGER_LABELS } from "@/lib/forms/types";

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function triggerAccent(trigger: FormSubmissionRow["form_trigger"]): {
  Icon: typeof ClipboardList;
  className: string;
  label: string;
} {
  const label = TRIGGER_LABELS[trigger] ?? trigger;

  if (trigger.startsWith("cleaning") || trigger.startsWith("equipment_cleaning")) {
    return { Icon: ClipboardCheck, className: "bg-sky-500/10 text-sky-600", label };
  }
  if (
    trigger.startsWith("maintenance") ||
    trigger.startsWith("equipment_maintenance")
  ) {
    return { Icon: Wrench, className: "bg-amber-500/10 text-amber-600", label };
  }
  return { Icon: Factory, className: "bg-emerald-500/10 text-emerald-600", label };
}

export function SubmissionRow({ row }: { row: FormSubmissionRow }) {
  const accent = triggerAccent(row.form_trigger);
  const activityLabel =
    (row.activity_kind && ACTIVITY_KIND_LABELS[row.activity_kind]) || null;

  return (
    <Link
      href={`/production/sessions/${row.uuid}`}
      className="flex flex-col gap-2 rounded-lg border border-border/60 bg-background/60 p-4 text-sm transition-colors hover:border-primary/40 hover:bg-muted/30"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className={`mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md ${accent.className}`}
          >
            <accent.Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">
              {row.form_name}
            </div>
            <div className="text-xs text-muted-foreground">{accent.label}</div>
          </div>
        </div>
        <div className="shrink-0 text-right text-xs text-muted-foreground">
          {formatDateTime(row.submitted_at)}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {row.workstation ? (
          <Badge tone="muted" className="gap-1 font-normal">
            <Cog className="size-3" /> {row.workstation.name}
          </Badge>
        ) : null}
        {row.equipment ? (
          <Badge tone="muted" className="gap-1 font-normal">
            <CircleAlert className="size-3" />
            Machine · {row.equipment.serial_number ?? row.equipment.uuid.slice(0, 8)}
          </Badge>
        ) : null}
        {activityLabel ? (
          <Badge tone="brand" className="font-normal">
            {activityLabel}
          </Badge>
        ) : null}
        {row.submitted_by.name ? (
          <Badge tone="brand" className="gap-1 font-normal">
            <User className="size-3" /> {row.submitted_by.name}
          </Badge>
        ) : null}
        <span className="ml-auto text-muted-foreground">
          {row.answer_count} {row.answer_count === 1 ? "answer" : "answers"}
        </span>
      </div>
    </Link>
  );
}
