"use client";

import { CheckCircle2, AlertTriangle, Info, ExternalLink } from "lucide-react";
import type { CompanyDefaults } from "@/lib/types";
import type { BOMSummary } from "@/lib/production/types";
import type { MoLinkedCustomerOrder } from "@/lib/production/types";
import { formatCompanyDate } from "@/lib/format/company";
import { cn } from "@/lib/utils";

interface Props {
  bom: Pick<
    BOMSummary,
    "npd_spec_sheet_uuid" | "npd_synced_at" | "npd_formulation_version_id"
  > | null;
  co: MoLinkedCustomerOrder | null;
  company: CompanyDefaults;
}

/**
 * Provenance / trust card the operator sees when picking a BOM on
 * the Create-MO form. Three verdicts:
 *
 *   * Green  — BOM's `npd_spec_sheet_uuid` matches the CO's
 *     currently-signed spec AND the BOM was synced before the
 *     customer signed. "Compliant."
 *   * Amber  — CO has no customer signature yet on the spec.
 *     "Customer hasn't approved yet." (Still legal to proceed for
 *     trial / sample MOs; caller decides whether to hide the card.)
 *   * Red    — BOM was re-synced AFTER the customer's signature, or
 *     the BOM's spec uuid doesn't match the CO's current spec.
 *     "Drift — customer signed a different BOM."
 *
 * Renders nothing when the BOM has no NPD provenance (BOM authored
 * directly on PSP) OR there is no linked CO (bare item, no project).
 */
export function BomTrustCard({ bom, co, company }: Props) {
  if (!bom || (!bom.npd_synced_at && !bom.npd_spec_sheet_uuid)) return null;
  if (!co) return null;

  const signedAt = co.npd_spec_customer_signed_at;
  const signedBy = co.npd_spec_customer_signed_by_name;
  const specUuid = co.npd_spec_sheet_uuid;
  const specUrl = co.npd_spec_sheet_url;
  const bomSyncedAt = bom.npd_synced_at;

  const specMismatch =
    !!bom.npd_spec_sheet_uuid &&
    !!specUuid &&
    bom.npd_spec_sheet_uuid !== specUuid;

  const bomSyncedAfterSignature =
    !!bomSyncedAt && !!signedAt && bomSyncedAt > signedAt;

  let verdict: "compliant" | "unsigned" | "drift" = "compliant";
  let reason: string | null = null;

  if (specMismatch) {
    verdict = "drift";
    reason = "BOM was pulled from a different spec than the one on this project.";
  } else if (bomSyncedAfterSignature) {
    verdict = "drift";
    reason =
      "BOM was re-synced from NPD after the customer signature — they signed a different version.";
  } else if (!signedAt) {
    verdict = "unsigned";
    reason = "Customer hasn't signed the spec sheet yet.";
  }

  const palette: Record<
    typeof verdict,
    { border: string; bg: string; icon: string; label: string }
  > = {
    compliant: {
      border: "border-emerald-200/70",
      bg: "bg-emerald-50/70",
      icon: "text-emerald-700",
      label: "BOM matches signed spec",
    },
    unsigned: {
      border: "border-amber-200/70",
      bg: "bg-amber-50/70",
      icon: "text-amber-700",
      label: "Spec not yet customer-signed",
    },
    drift: {
      border: "border-rose-200/70",
      bg: "bg-rose-50/70",
      icon: "text-rose-700",
      label: "BOM/spec drift",
    },
  };

  const style = palette[verdict];
  const Icon =
    verdict === "compliant"
      ? CheckCircle2
      : verdict === "unsigned"
        ? Info
        : AlertTriangle;

  return (
    <div
      className={cn(
        "mt-2 rounded-md border p-2.5 text-[11px]",
        style.border,
        style.bg,
      )}
    >
      <div
        className={cn(
          "mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide",
          style.icon,
        )}
      >
        <Icon className="size-3" />
        {style.label}
      </div>
      <dl className="space-y-1">
        {signedAt ? (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">Signed by</dt>
            <dd className="truncate text-right font-medium">
              {signedBy || "Customer"}
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                · {formatCompanyDate(signedAt, company)}
              </span>
            </dd>
          </div>
        ) : (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">Signed by</dt>
            <dd className="truncate text-right text-muted-foreground">—</dd>
          </div>
        )}
        {bomSyncedAt && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">BOM last synced</dt>
            <dd className="truncate text-right font-medium">
              {formatCompanyDate(bomSyncedAt, company)}
            </dd>
          </div>
        )}
        {bom.npd_formulation_version_id && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">Formulation version</dt>
            <dd className="truncate text-right font-mono text-[10px]">
              v{bom.npd_formulation_version_id}
            </dd>
          </div>
        )}
      </dl>
      {reason && <p className="mt-1.5 text-[10px] leading-snug">{reason}</p>}
      {specUrl && (
        <a
          href={specUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline"
        >
          Open spec sheet on NPD
          <ExternalLink className="size-2.5" />
        </a>
      )}
    </div>
  );
}
