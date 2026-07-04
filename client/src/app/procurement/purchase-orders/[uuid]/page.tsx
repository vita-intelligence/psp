import { notFound, redirect } from "next/navigation";
import { ShoppingCart } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Badge } from "@/components/ui/badge-mini";
import { TopBar } from "@/components/layout/top-bar";
import { RecordHero } from "@/components/layout/record-hero";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { CommentThread } from "@/components/comments/comment-thread";
import { listCommentsForEntity } from "@/lib/comments/server";
import { listInspectionsForPo } from "@/lib/goods-in/server";
import { getPurchaseOrder } from "@/lib/purchase-orders/server";
import { listItemsForReceive } from "@/lib/stock/server";
import { ProcurementSubnav } from "../../procurement-subnav";
import { PODocumentsToolbar } from "./po-documents-toolbar";
import { POInspectionsCard } from "./po-inspections-card";
import { POInvoicesCard } from "./po-invoices-card";
import { POLinesCard } from "./po-lines-card";
import { POPaperworkAlert } from "./po-paperwork-alert";
import { POWorkflowCard } from "./po-workflow-card";
import type { PurchaseOrderStatus } from "@/lib/types";
import { formatCompanyMoney } from "@/lib/format/company";
import { getCompanyDefaults } from "@/lib/company/server";
import { listInvoicesForPO } from "@/lib/invoices/server";

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
  const [po, items, prefs, initialComments, invoices, inspections] =
    await Promise.all([
      getPurchaseOrder(uuid),
      listItemsForReceive(),
      getCompanyDefaults(),
      listCommentsForEntity("purchase_order", uuid),
      listInvoicesForPO(uuid),
      // Same fetcher the mobile pre-receive page uses; returns every
      // inspection on this PO (draft + submitted + terminal) so the
      // operator can drill into a past goods-in record from the
      // desktop without leaving the PO context.
      listInspectionsForPo(uuid),
    ]);
  if (!po) notFound();

  const canCreate = hasPermission(user, "procurement.po_create");
  const canSubmit = hasPermission(user, "procurement.po_submit");
  const canApprove = hasPermission(user, "procurement.po_approve");
  const canDirectorApprove = hasPermission(
    user,
    "procurement.po_director_approve",
  );
  const canInvoiceView = hasPermission(user, "procurement.invoice_view");
  const canInvoiceManage = hasPermission(user, "procurement.invoice_manage");
  const canInvoiceApprove = hasPermission(user, "procurement.invoice_approve");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProcurementSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-5xl space-y-6">
          <RecordHero
            icon={ShoppingCart}
            code={po.code ?? `#${po.id}`}
            chips={
              <Badge tone={STATUS_TONE[po.status]}>
                {STATUS_LABEL[po.status]}
              </Badge>
            }
            title={po.vendor?.name ?? "—"}
            actions={
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
            }
            backHref="/procurement/purchase-orders"
            backLabel="Back to POs"
          />

          <POPaperworkAlert po={po} invoices={invoices ?? []} />

          <POWorkflowCard
            po={po}
            canSubmit={canSubmit}
            canApprove={canApprove}
            canDirectorApprove={canDirectorApprove}
            canCancel={canCreate}
          />

          <PODocumentsToolbar po={po} />

          <POLinesCard
            po={po}
            items={items ?? []}
            canEdit={canCreate && po.status === "draft"}
          />

          {/* Inspections card surfaces every GI inspection the
              goods-in operator ran against this PO — the auto-receive
              chain means each row corresponds to one physical
              delivery + QC verdict. This replaces the old "Record
              receipt" dialog: dimensions / packs / batch are all
              captured during the operator's mobile checklist, signing
              flips the PO to received automatically. Stays visible
              regardless of PO status so audit-trail lookups keep
              working post-close. */}
          <POInspectionsCard inspections={inspections} prefs={prefs} />

          {canInvoiceView && (
            <POInvoicesCard
              po={po}
              companyCurrency={prefs?.currency_code ?? "GBP"}
              invoices={invoices}
              canView={canInvoiceView}
              canManage={canInvoiceManage}
              canApprove={canInvoiceApprove}
            />
          )}

          <CommentThread
            entityType="purchase_order"
            entityUuid={po.uuid}
            initial={initialComments ?? []}
            canComment={canCreate}
            currentUserId={user.id}
          />

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
