import type { StockLotItemSummary } from "../types";

export interface LotHandlingTag {
  key: string;
  label: string;
  title?: string;
  className: string;
  icon: "alert" | "check" | "warning" | "cold";
}

/**
 * Distill the handling-tag chip set from an item's compliance state +
 * storage_tags + cold-chain attribute. Used by both the desktop and
 * mobile lot detail surfaces so the operator sees the same flags
 * everywhere (CoA required, allergen, cold chain, item not finalised).
 *
 * The logic mirrors `computeComplianceChips` on the mobile
 * pre-receive card — one source of truth.
 */
export function computeLotHandlingTags(
  item: StockLotItemSummary | null,
): LotHandlingTag[] {
  if (!item) return [];
  const tags: LotHandlingTag[] = [];

  // Item-level regulatory gate. `compliance_status` is server-side
  // optional on the lot's item summary; if absent we just skip.
  if (item.compliance_status === "draft") {
    tags.push({
      key: "compliance_draft",
      label: "Compliance pending",
      title: "Item not finalised — flag to QC.",
      className:
        "bg-amber-500/15 text-amber-700 dark:text-amber-300",
      icon: "warning",
    });
  } else if (item.compliance_status === "ready_for_use") {
    tags.push({
      key: "compliance_ready",
      label: "Compliant",
      className:
        "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
      icon: "check",
    });
  }

  const storageTags = Array.isArray(item.storage_tags)
    ? item.storage_tags
    : [];

  if (
    storageTags.some((t) => t === "requires_coa" || t === "requires_certificate")
  ) {
    tags.push({
      key: "coa",
      label: "CoA required",
      title: "Vendor must provide a Certificate of Analysis.",
      className: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
      icon: "warning",
    });
  }

  if (
    storageTags.some(
      (t) =>
        t === "allergen" ||
        (typeof t === "string" && t.startsWith("allergen_")),
    )
  ) {
    tags.push({
      key: "allergen",
      label: "Allergen",
      title:
        "Contains a regulated allergen — keep segregated from non-allergen stock.",
      className: "bg-red-500/15 text-red-700 dark:text-red-300",
      icon: "alert",
    });
  }

  // Cold-chain check via the item's attributes bag. Currently lots'
  // item summary doesn't carry attributes — surface only when the
  // storage_tags list explicitly includes a cold-chain marker. The
  // mobile pre-receive card walks the full attrs bag because it
  // gets the richer `PurchaseOrderLineItemSummary`.
  if (storageTags.includes("requires_cold_chain")) {
    tags.push({
      key: "cold_chain",
      label: "Cold chain",
      title:
        "Item must stay refrigerated — check temperature on movement.",
      className: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
      icon: "cold",
    });
  }

  // Surface any other storage_tags as plain neutral chips so admins
  // see the full set (custom tags an op team has invented).
  const knownPrefixes = new Set([
    "requires_coa",
    "requires_certificate",
    "allergen",
    "requires_cold_chain",
  ]);

  for (const t of storageTags) {
    if (typeof t !== "string") continue;
    if (knownPrefixes.has(t)) continue;
    if (t.startsWith("allergen_")) continue;
    tags.push({
      key: `tag_${t}`,
      label: t,
      className: "bg-muted text-foreground/70",
      icon: "check",
    });
  }

  return tags;
}
