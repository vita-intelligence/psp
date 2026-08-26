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
 * "Recent deliveries" on the item detail page. Lists the last N
 * goods-in inspections that touched this item across ANY PO. Each row
 * links out to the desktop inspection detail page where the full
 * read-only summary lives.
 *
 * A PO can arrive across several trucks (staggered dispatches), each
 * with its own inspection — so an item that's routinely ordered will
 * have many deliveries. Newest-first, capped at 10 by default.
 */
export function ItemRecentDeliveriesCard({ inspections, prefs }: Props) {
  const sorted = [...inspections].sort((a, b) => {
    const ak = a.delivery_date ?? a.inserted_at ?? "";
    const bk = b.delivery_date ?? b.inserted_at ?? "";
    return bk.localeCompare(ak);
  });

  return (
    <section className="rounded-lg border border-border/60 bg-card p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Microscope className="size-4" />
          Recent deliveries
          <span className="text-xs text-muted-foreground/70">
            · {inspections.length}
          </span>
        </h2>
        <span className="text-[11px] text-muted-foreground">
          Last 10 across all POs
        </span>
      </header>

      {inspections.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No goods-in inspections have touched this item yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((insp) => {
            const Icon = STATUS_ICON[insp.status];
            const poCode = insp.purchase_order_code;
            const poUuid = insp.purchase_order_uuid;
            return (
              <li key={insp.uuid}>
                <div className="flex flex-wrap items-start gap-3 rounded-md border border-border/40 px-3 py-2.5 hover:bg-muted/30">
                  <Link
                    href={`/procurement/inspections/${insp.uuid}`}
                    className="min-w-0 flex-1 space-y-1"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs font-semibold text-muted-foreground">
                        GI #{insp.id}
                      </span>
                      <Badge tone={STATUS_TONE[insp.status]}>
                        <Icon className="size-2.5" />
                        {STATUS_LABEL[insp.status]}
                      </Badge>
                      {poCode && (
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {poCode}
                        </span>
                      )}
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
                  </Link>
                  {poUuid && (
                    <Link
                      href={`/procurement/purchase-orders/${poUuid}`}
                      className="shrink-0 self-center rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                    >
                      Open PO
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
