import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, ShoppingCart } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge-mini";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { getPurchaseOrder } from "@/lib/purchase-orders/server";
import {
  listItemsForReceive,
  listWarehousesForReceive,
} from "@/lib/stock/server";
import { ProcurementSubnav } from "../../procurement-subnav";
import { POLinesCard } from "./po-lines-card";
import { POReceiveCard } from "./po-receive-card";
import { POWorkflowCard } from "./po-workflow-card";
import type { PurchaseOrderStatus } from "@/lib/types";
import { formatCompanyMoney } from "@/lib/format/company";
import { getCompanyDefaults } from "@/lib/company/server";

export const metadata = { title: "PO · Procurement · PSP" };

const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: "Draft",
  pending_approver: "Pending approver",
  pending_director: "Pending director",
  approved: "Approved",
  ordered: "Ordered",
  partially_received: "Partially received",
  received: "Received",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<
  PurchaseOrderStatus,
  "muted" | "amber" | "indigo" | "emerald" | "destructive"
> = {
  draft: "muted",
  pending_approver: "amber",
  pending_director: "amber",
  approved: "indigo",
  ordered: "indigo",
  partially_received: "amber",
  received: "emerald",
  cancelled: "destructive",
};

export default async function PODetailPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "procurement.po_view")) {
    redirect("/settings/profile");
  }

  const { uuid } = await params;
  const [po, items, warehouses, prefs] = await Promise.all([
    getPurchaseOrder(uuid),
    listItemsForReceive(),
    listWarehousesForReceive(),
    getCompanyDefaults(),
  ]);
  if (!po) notFound();

  const canCreate = hasPermission(user, "procurement.po_create");
  const canSubmit = hasPermission(user, "procurement.po_submit");
  const canApprove = hasPermission(user, "procurement.po_approve");
  const canDirectorApprove = hasPermission(
    user,
    "procurement.po_director_approve",
  );
  const canReceive = hasPermission(user, "procurement.po_receive");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProcurementSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-5xl space-y-6">
          <div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
            >
              <Link href="/procurement/purchase-orders">
                <ChevronLeft className="mr-1 size-4" />
                Back to POs
              </Link>
            </Button>
          </div>

          <header className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="size-4 text-muted-foreground" />
                  <span className="font-mono text-xs font-semibold text-muted-foreground">
                    {po.code ?? `#${po.id}`}
                  </span>
                  <Badge tone={STATUS_TONE[po.status]}>
                    {STATUS_LABEL[po.status]}
                  </Badge>
                </div>
                <h1 className="truncate text-2xl font-semibold tracking-tight">
                  {po.vendor?.name ?? "—"}
                </h1>
              </div>
              <div className="text-right">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Total
                </p>
                <p className="font-mono text-xl font-semibold tracking-tight">
                  {formatCompanyMoney(po.total_amount, prefs, {
                    currency_code: po.currency_code,
                  })}
                </p>
              </div>
            </div>
          </header>

          <POWorkflowCard
            po={po}
            canSubmit={canSubmit}
            canApprove={canApprove}
            canDirectorApprove={canDirectorApprove}
            canCancel={canCreate}
          />

          <POLinesCard
            po={po}
            items={items ?? []}
            canEdit={canCreate && po.status === "draft"}
          />

          {["ordered", "partially_received"].includes(po.status) && (
            <POReceiveCard
              po={po}
              warehouses={warehouses}
              canReceive={canReceive}
            />
          )}

          <AuditMetaSection
            inserted_at={po.inserted_at}
            updated_at={po.updated_at}
            created_by={po.created_by ?? null}
            updated_by={po.updated_by ?? null}
          />
          <AuditHistoryCard entityType="purchase_order" entityId={po.id} />
        </div>
      </main>
    </div>
  );
}
