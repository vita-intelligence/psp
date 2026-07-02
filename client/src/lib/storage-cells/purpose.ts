import type { StorageCellPurpose } from "../types";

/**
 * Purpose chip metadata — colour, label, short description. Single
 * source of truth for the warehouse-plan select + the lot-detail
 * placement card chip. Adding a new purpose flows through here so
 * the whole app picks up the chip in one edit.
 */
export interface PurposeMeta {
  value: StorageCellPurpose;
  label: string;
  description: string;
  /** Tailwind class string for the small inline chip — kept
   *  light/dark-mode aware via the `dark:` variants. */
  chipClassName: string;
}

export const CELL_PURPOSES: PurposeMeta[] = [
  {
    value: "regular",
    label: "Regular",
    description: "Normal pick face. The default for new cells.",
    chipClassName:
      "bg-muted text-muted-foreground border border-border/60",
  },
  {
    value: "quarantine",
    label: "Quarantine",
    description:
      "Holds incoming lots until goods-in QC clears them. Auto-routes received lots here.",
    chipClassName:
      "bg-amber-500/10 text-amber-700 border border-amber-500/30 dark:text-amber-400",
  },
  {
    value: "hold",
    label: "Hold",
    description: "Operator-marked pause post-QC. Auto-routes on `held` events.",
    chipClassName:
      "bg-yellow-500/10 text-yellow-700 border border-yellow-500/30 dark:text-yellow-400",
  },
  {
    value: "rejected",
    label: "Rejected",
    description: "Failed QC, awaiting disposal. Auto-routes on `qc_failed` events.",
    chipClassName:
      "bg-red-500/10 text-red-700 border border-red-500/30 dark:text-red-400",
  },
  {
    value: "dispatch",
    label: "Dispatch",
    description:
      "Staging area for outbound shipments. Not currently auto-routed.",
    chipClassName:
      "bg-blue-500/10 text-blue-700 border border-blue-500/30 dark:text-blue-400",
  },
  {
    value: "finished_quarantine",
    label: "Finished quarantine",
    description:
      "Holds finished-product output lots waiting on Final Product Release (BRCGS Issue 9 § 5.6). Physically separated from raw-material quarantine so incoming and outgoing 'unproven' stock never share a bay. The release form hard-blocks until the lot sits in one of these.",
    chipClassName:
      "bg-sky-500/10 text-sky-700 border border-sky-500/30 dark:text-sky-400",
  },
  {
    value: "three_pl_storage",
    label: "3PL storage",
    description:
      "Bailee custody — customer-owned finished goods stored on our floor. Released lots the operator routes to 3PL land here and accrue storage charges (per m³ per day, rate from company settings) until dispatched. Physically segregated from own stock so a warehouse audit can distinguish bailed vs owned inventory.",
    chipClassName:
      "bg-violet-500/10 text-violet-700 border border-violet-500/30 dark:text-violet-400",
  },
];

export const PURPOSE_BY_VALUE: Record<StorageCellPurpose, PurposeMeta> =
  CELL_PURPOSES.reduce(
    (acc, m) => {
      acc[m.value] = m;
      return acc;
    },
    {} as Record<StorageCellPurpose, PurposeMeta>,
  );

export function purposeMeta(
  value: StorageCellPurpose | string | null | undefined,
): PurposeMeta {
  if (value && value in PURPOSE_BY_VALUE) {
    return PURPOSE_BY_VALUE[value as StorageCellPurpose];
  }
  return PURPOSE_BY_VALUE.regular;
}
