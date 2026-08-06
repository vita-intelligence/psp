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

  const base = npdBaseUrl.replace(/\/+$/, "");
  const href =
    `${base}/formulations/${encodeURIComponent(mo.npd_formulation_uuid)}` +
    `/qc/?trial_batch=${encodeURIComponent(mo.npd_trial_batch_uuid)}&auto=1`;

  const status = mo.npd_validation_status;
  const failed = status === "failed";

  return (
    <section
      className={cn(
        "rounded-xl border p-4",
        failed
          ? "border-rose-300 bg-rose-50/60 dark:border-rose-900/50 dark:bg-rose-950/20"
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
                    : "text-indigo-900 dark:text-indigo-100",
                )}
              >
                Trial validation on NPD
              </p>
              <ValidationStatusPill status={status} />
            </div>
            <p
              className={cn(
                "text-xs",
                failed
                  ? "text-rose-800/80 dark:text-rose-200/80"
                  : "text-indigo-800/80 dark:text-indigo-200/80",
              )}
            >
              Output QC on a trial batch must be paired with an NPD
              product validation. Opens the existing validation for
              this batch, or creates a new one.
            </p>
          </div>
        </div>

        <Button asChild size="sm" className="shrink-0">
          <a href={href} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-3.5" />
            Open on NPD
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
