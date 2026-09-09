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
 *   * Green  — BOM's formulation version matches the version the
 *     customer signed against. "Compliant."
 *   * Amber  — CO has no customer signature yet on the spec.
 *     "Customer hasn't approved yet." (Still legal to proceed for
 *     trial / sample MOs; caller decides whether to hide the card.)
 *   * Red    — BOM's formulation version differs from the signed
 *     version. "Drift — recipe changed after customer signature."
 *
 * Renders nothing when the BOM has no NPD provenance (BOM authored
 * directly on PSP) OR there is no linked CO (bare item, no project).
 */
export function BomTrustCard({ bom, co, company }: Props) {
  if (!bom || (!bom.npd_synced_at && !bom.npd_spec_sheet_uuid)) return null;
  if (!co) return null;

  // Prefer the newer proposal-scoped FINAL-spec mirror
  // (``npd_final_spec_*``): it's stamped when the customer actually
  // signs the per-proposal FINAL, which is what the Trust Card is
  // trying to represent. RTG multi-order requires this — each order
  // has its own signed FINAL, and the legacy ``npd_spec_*`` family
  // is populated by a director-approval sync where customer_signed_at
  // is still nil, so the card was rendering "Customer hasn't signed"
  // on RTG orders even after the customer clearly signed on the
  // portal. Falls back to the legacy fields for pre-merge rows.
  const signedAt =
    co.npd_final_spec_signed_at ?? co.npd_spec_customer_signed_at;
  const signedBy = co.npd_spec_customer_signed_by_name;
  const specUrl = co.npd_spec_sheet_url;
  const bomSyncedAt = bom.npd_synced_at;

  // Reorder shortcut: the portal Reorder flow mints a fresh
  // Formulation on NPD (with ``version_number`` restarting at 1)
  // but points its ProposalLine at the SOURCE formulation's
  // already-signed FINAL spec (whose ``version_number`` reflects
  // wherever the source recipe stood at sign-time — commonly 4+).
  // The version equality check below would compare source's v4 to
  // reorder's own v1 and false-positive "drift — recipe was edited
  // after signature" on every reorder MO, even though the reorder
  // shell locks the recipe as a copy of source and drift is
  // impossible by construction. Bypass the check entirely for
  // reorders; the operator's "same recipe as the original" mental
  // model IS what the code shows.
  const isReorder = co.is_reorder === true;

  // Version-based drift detection: the customer signed against a
  // specific formulation version (``npd_final_spec_formulation_version_id``);
  // the BOM carries its own ``npd_formulation_version_id``. Equal
  // versions ⇒ same recipe ⇒ no drift, regardless of when the BOM
  // was last re-pushed. Different versions ⇒ recipe was edited
  // after the signature ⇒ the operator needs to know.
  //
  // Previous implementation compared ``bom.npd_synced_at`` vs
  // ``co.npd_final_spec_signed_at`` — every BOM re-push after sign
  // (SPOU refresh, provenance metadata update, packaging fix, etc.)
  // false-positived as drift even though the recipe was byte-for-
  // byte the version the customer approved.
  //
  // ``signedVersion`` is null on legacy CO rows written before the
  // field existed; in that case we fall back to the old timestamp
  // check so those rows still get some drift protection (worst
  // case: false-positive drift on a legacy row, same as today).
  const signedVersion = co.npd_final_spec_formulation_version_id;
  const bomVersion = bom.npd_formulation_version_id;
  const versionMismatch =
    !isReorder &&
    !!signedVersion &&
    !!bomVersion &&
    signedVersion !== bomVersion;
  const bomSyncedAfterSignatureLegacy =
    !isReorder &&
    !signedVersion &&
    !!bomSyncedAt &&
    !!signedAt &&
    bomSyncedAt > signedAt;

  let verdict: "compliant" | "unsigned" | "drift" = "compliant";
  let reason: string | null = null;

  if (versionMismatch) {
    verdict = "drift";
    reason = `Customer signed formulation v${signedVersion}; this BOM is on v${bomVersion}. The recipe was edited after signature.`;
  } else if (bomSyncedAfterSignatureLegacy) {
    verdict = "drift";
    reason =
      "BOM was re-synced from NPD after the customer signature. Confirm the recipe still matches what they signed.";
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
