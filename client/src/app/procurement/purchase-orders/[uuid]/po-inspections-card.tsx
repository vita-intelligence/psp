import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  Microscope,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge-mini";
import { formatCompanyDate } from "@/lib/format/company";
import type { FormatPrefs } from "@/lib/format/company";
import type { Inspection, InspectionStatus } from "@/lib/goods-in/types";

interface Props {
  inspections: Inspection[];
  prefs: FormatPrefs | null;
}

const STATUS_LABEL: Record<InspectionStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  hold: "On hold",
  rejected: "Rejected",
};

const STATUS_TONE: Record<
  InspectionStatus,
  "muted" | "amber" | "emerald" | "destructive" | "indigo"
> = {
  draft: "muted",
  submitted: "indigo",
  approved: "emerald",
  hold: "amber",
  rejected: "destructive",
};

const STATUS_ICON: Record<InspectionStatus, typeof Clock> = {
  draft: Clock,
  submitted: ShieldCheck,
  approved: CheckCircle2,
  hold: Clock,
  rejected: XCircle,
};

/**
 * "Inspections" rollup on the PO detail page. Each row mirrors the
 * mobile ledger row shape: GI code + vendor delivery date + operator +
 * approver + status badge, linking to the desktop detail page where
 * the full read-only summary lives (photos, signatures, packs,
 * per-pack print buttons).
 */
export function POInspectionsCard({ inspections, prefs }: Props) {
  return (
    <section className="rounded-lg border border-border/60 bg-card p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Microscope className="size-4" />
          Inspections
          <span className="text-xs text-muted-foreground/70">
            · {inspections.length}
          </span>
        </h2>
      </header>

      {inspections.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No goods-in inspections recorded on this PO yet. The operator
          starts one from the mobile dock when the truck arrives —
          signing kicks off the receive chain automatically.
        </p>
      ) : (
        <ul className="space-y-2">
          {inspections.map((insp) => {
            const Icon = STATUS_ICON[insp.status];
            return (
              <li key={insp.uuid}>
                <Link
                  href={`/procurement/inspections/${insp.uuid}`}
                  className="flex flex-wrap items-start gap-3 rounded-md border border-border/40 px-3 py-2.5 hover:bg-muted/30"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs font-semibold text-muted-foreground">
                        GI #{insp.id}
                      </span>
                      <Badge tone={STATUS_TONE[insp.status]}>
                        <Icon className="size-2.5" />
                        {STATUS_LABEL[insp.status]}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Delivered{" "}
                      {insp.delivery_date
                        ? formatCompanyDate(insp.delivery_date, prefs)
                        : "—"}
                      {insp.goods_in_operator
                        ? ` · operator ${insp.goods_in_operator.name}`
                        : ""}
                      {insp.quality_approver
                        ? ` · approver ${insp.quality_approver.name}`
                        : ""}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
