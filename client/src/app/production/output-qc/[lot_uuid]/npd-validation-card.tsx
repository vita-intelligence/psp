import { AlertTriangle, ExternalLink, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OutputQcEntry } from "@/lib/production/types";

interface Props {
  entry: OutputQcEntry;
  npdBaseUrl: string;
}

/**
 * "Validate on NPD" card. Only rendered for R&D MOs (trial/sample)
 * whose PSP row has the NPD formulation + trial batch back-refs.
 * Clicking opens NPD's `/formulations/{fid}/qc/` with `trial_batch`
 * + `auto=1` query params — NPD reads them and either opens the
 * existing validation for this batch OR creates a new one, then
 * redirects to the editor.
 *
 * Shows the current NPD validation status pill (draft / in progress /
 * passed / failed) so QA can see at a glance whether the Output QC
 * pass gate is open. On `failed`, renders a red banner with the
 * failure reason — the lot has already been auto-rejected by the
 * webhook, so the operator just needs to acknowledge and re-plan.
 */
export function NpdValidationCard({ entry, npdBaseUrl }: Props) {
  const mo = entry.mo;
  if (!mo || !mo.npd_formulation_uuid || !mo.npd_trial_batch_uuid) return null;

  // Customer-paid sample fulfilment (MO's linked CO has
  // ``sample_kind = true``) → hide the card. The MO is producing
  // a specific sample kit a customer ordered via the /samples
  // fulfilment queue — that's production of an already-validated
  // recipe, not R&D validation. Applies to BOTH Custom + RTG
  // (customer paid samples on either flavour skip per-batch
  // validation the same way).
  //
  // Internal validation trials — scientist creates a batch on NPD
  // to prove a new recipe (Custom trial-slot OR RTG pre-publish
  // trial) — have no CO link, so this stays false and the card
  // correctly shows. ``batch.kind`` is NOT the right signal:
  // scientists commonly pick ``trial`` on customer-paid samples
  // too (bench-scale run), so gating on kind would misfire.
  if (mo.is_customer_sample_fulfilment) return null;

  const base = npdBaseUrl.replace(/\/+$/, "");
  const href =
    `${base}/formulations/${encodeURIComponent(mo.npd_formulation_uuid)}` +
    `/qc/?trial_batch=${encodeURIComponent(mo.npd_trial_batch_uuid)}&auto=1`;

  const status = mo.npd_validation_status;
  const failed = status === "failed";
  const passed = status === "passed";
  // Blocks the QC actions below — draft, in_progress, or null all
  // read the same way to the operator (the form isn't done).
  const blocking = !passed && !failed;

  return (
    <section
      className={cn(
        "rounded-xl border p-4",
        failed
          ? "border-rose-300 bg-rose-50/60 dark:border-rose-900/50 dark:bg-rose-950/20"
          : blocking
            ? "border-2 border-amber-500/70 bg-amber-50 shadow-md ring-1 ring-amber-500/20 dark:border-amber-500/50 dark:bg-amber-950/25"
            : "border-indigo-200 bg-indigo-50/60 dark:border-indigo-900/50 dark:bg-indigo-950/20",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "grid size-9 place-items-center rounded-full",
              failed
                ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                : blocking
                  ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                  : "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
            )}
          >
            <FlaskConical className="size-5" />
          </span>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p
                className={cn(
                  "text-sm font-semibold",
                  failed
                    ? "text-rose-900 dark:text-rose-100"
                    : blocking
                      ? "text-amber-900 dark:text-amber-100"
                      : "text-indigo-900 dark:text-indigo-100",
                )}
              >
                {blocking
                  ? "Trial batch validation required"
                  : "Trial validation on NPD"}
              </p>
              <ValidationStatusPill status={status} />
            </div>
            <p
              className={cn(
                "text-xs",
                failed
                  ? "text-rose-800/80 dark:text-rose-200/80"
                  : blocking
                    ? "text-amber-900/90 dark:text-amber-100/90"
                    : "text-indigo-800/80 dark:text-indigo-200/80",
              )}
            >
              {blocking ? (
                <>
                  <span className="font-semibold">
                    Pass and Fail on this QC card are locked until
                    this validation reaches Passed.
                  </span>{" "}
                  Open the form on NPD, fill weight / hardness /
                  thickness / disintegration / organoleptic tests +
                  MRPeasy checklist, then sign as scientist and R&amp;D
                  manager. NPD auto-pushes the passed status back to
                  PSP and this QC card unlocks.
                </>
              ) : (
                <>
                  Output QC on a trial batch must be paired with an
                  NPD product validation. Opens the existing
                  validation for this batch, or creates a new one.
                </>
              )}
            </p>
          </div>
        </div>

        <Button
          asChild
          size={blocking ? "default" : "sm"}
          className={cn(
            "shrink-0",
            blocking &&
              "bg-amber-600 text-white shadow-sm hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400",
          )}
        >
          <a href={href} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-3.5" />
            {blocking ? "Open validation on NPD" : "Open on NPD"}
          </a>
        </Button>
      </div>

      {failed && mo.npd_validation_failure_reason && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-300 bg-white/60 px-3 py-2 text-xs text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <div>
            <p className="font-semibold">Validation failed — lot auto-rejected.</p>
            <p className="mt-0.5 whitespace-pre-line">
              {mo.npd_validation_failure_reason}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function ValidationStatusPill({
  status,
}: {
  status: OutputQcEntry["mo"] extends infer T
    ? T extends { npd_validation_status: infer S }
      ? S
      : null
    : null;
}) {
  const label =
    status === "passed"
      ? "Passed"
      : status === "failed"
        ? "Failed"
        : status === "in_progress"
          ? "In progress"
          : status === "draft"
            ? "Draft"
            : "Not started";

  const cls =
    status === "passed"
      ? "bg-emerald-500/15 text-emerald-700 ring-emerald-200 dark:text-emerald-300 dark:ring-emerald-900/50"
      : status === "failed"
        ? "bg-rose-500/15 text-rose-700 ring-rose-200 dark:text-rose-300 dark:ring-rose-900/50"
        : status === "in_progress"
          ? "bg-amber-500/15 text-amber-800 ring-amber-200 dark:text-amber-300 dark:ring-amber-900/50"
          : "bg-muted text-muted-foreground ring-border";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset",
        cls,
      )}
    >
      {label}
    </span>
  );
}
