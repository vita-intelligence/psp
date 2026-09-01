/**
 * Human-friendly expansion under an MO quantity input for finished-
 * product items with a ``servings_per_pack`` set. Turns a raw stored
 * qty of "0.05 packs" into "= 3 gummies (60 per pcs)", which is what
 * a trial-batch scientist typing "3 gummies" on the Create-MO modal
 * actually meant. Renders nothing on items without a
 * ``servings_per_pack`` (raw materials, semi-finished stages, RTG
 * SKUs without a spec, etc.) so it never clutters the form for the
 * common production case.
 *
 * Deliberately display-only — the stored MO qty stays in stock units
 * (packs), because every downstream calc (BOM ratios, costing, yield
 * variance, dispatch) is built against stock units. This caption
 * just tells the reader what the number IS in servings, without
 * changing anything under the hood.
 *
 * Used on:
 *   * MO detail page — ``mo-form.tsx`` quantity input
 *   * Finish-production dialog — ``production-run-detail.tsx``
 *     produced-quantity input
 *   * (Add wherever else a raw stock-unit qty needs the "= N servings"
 *     nudge — same import, no additional config.)
 */

const DOSAGE_FORM_NOUN: Record<string, string> = {
  capsule: "capsules",
  tablet: "tablets",
  powder: "servings",
  liquid: "doses",
  gummy: "gummies",
  other: "servings",
};

export function ServingsCaption({
  quantity,
  servingsPerPack,
  dosageForm,
  uomSymbol,
}: {
  quantity: string;
  servingsPerPack: number | null;
  dosageForm: string | null;
  uomSymbol: string | null;
}) {
  const qtyNum = Number(quantity);
  const spp = servingsPerPack ?? 0;
  if (!Number.isFinite(qtyNum) || qtyNum <= 0 || spp <= 0) return null;

  const totalServings = qtyNum * spp;
  // Whole-number math renders cleanly; fractional collapses to a
  // couple of decimals so 0.05 × 60 = 3 reads as "3" and
  // 0.075 × 60 = 4.5 reads as "4.5" (not "4.50").
  const servingsText = Number.isInteger(totalServings)
    ? String(totalServings)
    : String(Number(totalServings.toFixed(2)));
  const noun = DOSAGE_FORM_NOUN[dosageForm ?? "other"] ?? "servings";
  const packLabel = uomSymbol ?? "pack";

  return (
    <p className="text-[11px] leading-snug text-muted-foreground">
      = {servingsText} {noun} ({spp} per {packLabel})
    </p>
  );
}
