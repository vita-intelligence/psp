import {
  CheckCircle2,
  ClipboardList,
  FlaskConical,
  Package,
  PackageCheck,
  Rocket,
  ShieldCheck,
  Truck,
  Wrench,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ManufacturingOrderStage,
  ManufacturingOrder,
} from "@/lib/production/types";

/**
 * Ordered list of the 8 macro stages an MO moves through, matching
 * the server's `Backend.Production.mo_stages_ordered/0`. Keep in
 * sync — if the server ever reorders / renames, this is the FE
 * mirror.
 *
 * `done` + `cancelled` are terminal DISPLAY states, not stepper
 * cells — they render as a full-width banner instead of a chip.
 */
const STAGES: {
  key: Exclude<ManufacturingOrderStage, "done" | "cancelled">;
  label: string;
  short: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Plain-English hint the operator sees on hover / focus. */
  hint: string;
}[] = [
  {
    key: "mo_request",
    label: "MO request",
    short: "Request",
    icon: ClipboardList,
    hint: "Create → prepare → approve. Two signatures required before release.",
  },
  {
    key: "pickup",
    label: "Pickup items",
    short: "Pickup",
    icon: Package,
    hint: "Warehouse picker walks the trolley to collect every ingredient.",
  },
  {
    key: "transfer",
    label: "Transfer",
    short: "Transfer",
    icon: Truck,
    hint: "Trolley moves from warehouse to the production feed cell.",
  },
  {
    key: "preflight",
    label: "Preflight",
    short: "Preflight",
    icon: ShieldCheck,
    hint: "Operator confirms every ingredient at the feed cell + signs preflight.",
  },
  {
    key: "production",
    label: "Production",
    short: "Run",
    icon: Rocket,
    hint: "Run in progress. Start → finish on the shop-floor kiosk.",
  },
  {
    key: "quality",
    label: "Quality",
    short: "QC",
    icon: FlaskConical,
    hint: "QA signs off every output lot (pass → available, fail → rejected).",
  },
  {
    key: "closeout",
    label: "Closeout",
    short: "Closeout",
    icon: PackageCheck,
    hint: "Per-booking consumption + leftover routing decisions.",
  },
  {
    key: "return_pickup",
    label: "Return pickup",
    short: "Return",
    icon: Wrench,
    hint: "Leftover ingredients trolley back to warehouse.",
  },
];

interface StageStepperProps {
  /** Current stage — usually `mo.stage` from the server payload. */
  stage: ManufacturingOrderStage;
  /** 1-based position from `mo.stage_index`. Not strictly required
   *  (we can recompute from `stage`) but taking it explicit keeps
   *  the FE + server in lockstep + covers the `done` special case
   *  where server returns 8. */
  stageIndex: number | null;
  /** Total, from `mo.stage_total`. Server-owned so we don't hard-code. */
  stageTotal: number;
  /** Compact mode for cards / lists — smaller chips, no hint text.
   *  Full mode for the MO detail page header. */
  compact?: boolean;
  className?: string;
}

/**
 * Horizontal 8-cell stepper showing which macro stage an MO is on.
 *
 * ### Visual states per cell
 *
 *   * **Complete** — filled emerald chip, checkmark icon. Prior stages.
 *   * **Current** — bright brand-blue chip, ring, pulsing dot. The `stage` cell.
 *   * **Upcoming** — muted outlined chip. Stages the MO hasn't reached.
 *
 * ### Terminal display states
 *
 *   * `done` — every stage highlighted emerald, "All done" banner below.
 *   * `cancelled` — grey out every cell, red "Cancelled" banner.
 *
 * ### Why one component
 *
 * Every surface that renders an MO (detail page, project board card,
 * MO ledger row hover) needs the same visual language so operators
 * pattern-match instantly. Compact / full toggle covers the density
 * spectrum without forking implementations.
 */
export function MoStageStepper({
  stage,
  stageIndex,
  stageTotal,
  compact = false,
  className,
}: StageStepperProps) {
  if (stage === "cancelled") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive",
          className,
        )}
      >
        <XCircle className="size-4 shrink-0" />
        <span className="font-semibold">Cancelled</span>
        <span className="text-xs opacity-80">
          This MO was cancelled — no further steps apply.
        </span>
      </div>
    );
  }

  const currentIndex =
    stage === "done" ? stageTotal : (stageIndex ?? 1);

  return (
    <div className={cn("w-full", className)}>
      <ol
        className={cn(
          "flex w-full items-center gap-1",
          compact ? "text-[10px]" : "text-xs",
        )}
        aria-label="Manufacturing order progress"
      >
        {STAGES.map((s, idx) => {
          const position = idx + 1;
          const isComplete = position < currentIndex || stage === "done";
          const isCurrent = position === currentIndex && stage !== "done";
          const Icon = isComplete ? CheckCircle2 : s.icon;

          return (
            <li
              key={s.key}
              className={cn(
                "flex flex-1 items-center gap-1.5",
                idx < STAGES.length - 1 && "min-w-0",
              )}
              aria-current={isCurrent ? "step" : undefined}
              title={compact ? `${s.label} — ${s.hint}` : undefined}
            >
              <div
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-2 py-1 transition-colors",
                  compact ? "text-[10px]" : "text-[11px]",
                  isComplete &&
                    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
                  isCurrent &&
                    "bg-brand/15 text-brand ring-2 ring-brand/40 font-semibold",
                  !isComplete &&
                    !isCurrent &&
                    "bg-muted/40 text-muted-foreground",
                )}
              >
                {isCurrent && (
                  <span className="relative flex size-1.5 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand/60 opacity-60" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-brand" />
                  </span>
                )}
                <Icon
                  className={cn(compact ? "size-3" : "size-3.5", "shrink-0")}
                />
                {!compact && (
                  <span className="whitespace-nowrap font-medium">
                    {s.short}
                  </span>
                )}
              </div>
              {idx < STAGES.length - 1 && (
                <div
                  className={cn(
                    "h-px flex-1 min-w-1.5 rounded",
                    isComplete
                      ? "bg-emerald-500/40"
                      : "bg-border/60",
                  )}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>

      {!compact && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {stage === "done"
            ? "All 8 stages complete."
            : `Stage ${currentIndex} of ${stageTotal} — ${STAGES[currentIndex - 1]?.hint ?? ""}`}
        </p>
      )}
    </div>
  );
}

/**
 * Convenience wrapper that pulls `stage`, `stage_index`, `stage_total`
 * off an MO payload so callers write `<MoStepperFromMo mo={mo} />`
 * instead of prop-drilling three fields. Falls back cleanly when
 * the payload is missing stage fields (older backend / test data).
 */
export function MoStepperFromMo({
  mo,
  compact,
  className,
}: {
  mo: Pick<ManufacturingOrder, "stage" | "stage_index" | "stage_total">;
  compact?: boolean;
  className?: string;
}) {
  return (
    <MoStageStepper
      stage={mo.stage ?? "mo_request"}
      stageIndex={mo.stage_index ?? 1}
      stageTotal={mo.stage_total ?? 8}
      compact={compact}
      className={className}
    />
  );
}
