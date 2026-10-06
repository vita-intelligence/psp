import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { listCommentsForEntity } from "@/lib/comments/server";
import { listInspectionsForPo } from "@/lib/goods-in/server";
import { getPurchaseOrder } from "@/lib/purchase-orders/server";
import { listItemsForReceive } from "@/lib/stock/server";
import { ProcurementSubnav } from "../../procurement-subnav";
import { PODetailContent } from "./po-detail-content";
import { getCompanyDefaults } from "@/lib/company/server";
import { listInvoicesForPO } from "@/lib/invoices/server";

export const metadata = { title: "PO · Procurement · PSP" };

// Force per-request rendering so ``router.refresh()`` after an approve
// / cancel / mark-ordered action actually re-runs this server
// component instead of serving a stale Router Cache payload. The
// backend fetch is already ``cache: "no-store"`` — this just closes
// the client-cache gap so a signed PO shows its new status without a
// manual browser reload.
export const dynamic = "force-dynamic";

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
        <PODetailContent
          uuid={uuid}
          initialPo={po}
          initialItems={items ?? []}
          prefs={prefs}
          initialComments={initialComments ?? []}
          initialInvoices={invoices}
          initialInspections={inspections}
          currentUserId={user.id}
          canCreate={canCreate}
          canSubmit={canSubmit}
          canApprove={canApprove}
          canDirectorApprove={canDirectorApprove}
          canInvoiceView={canInvoiceView}
          canInvoiceManage={canInvoiceManage}
          canInvoiceApprove={canInvoiceApprove}
        />
      </main>
    </div>
  );
}
