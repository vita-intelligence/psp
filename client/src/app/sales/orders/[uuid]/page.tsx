import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, ShoppingBag } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { Badge } from "@/components/ui/badge-mini";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { CommentThread } from "@/components/comments/comment-thread";
import { listCommentsForEntity } from "@/lib/comments/server";
import { getCustomerOrder } from "@/lib/customer-orders/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { getOrderWizard } from "@/lib/order-wizard/server";
import { listActiveWarehousesForMobile } from "@/lib/warehouses/server";
import type { CustomerOrderStatus } from "@/lib/types";
import { EditModeToggle } from "@/components/forms/edit-mode-toggle";
import { SalesSubnav } from "../../sales-subnav";
import { COHeaderCard } from "./co-header-card";
import { COLinesCard } from "./co-lines-card";
import { COWorkflowCard } from "./co-workflow-card";
import { CoTabs } from "./co-tabs";

export const metadata = { title: "Customer order · Sales · PSP" };

const STATUS_LABEL: Record<CustomerOrderStatus, string> = {
  draft: "Draft",
  pending_approver: "Awaiting approver",
  pending_director: "Awaiting director",
  approved: "Approved",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<
  CustomerOrderStatus,
  "emerald" | "amber" | "sky" | "muted" | "destructive"
> = {
  draft: "muted",
  pending_approver: "amber",
  pending_director: "amber",
  approved: "sky",
  confirmed: "emerald",
  cancelled: "destructive",
};

export default async function CustomerOrderDetailPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "customer_orders.view")) {
    redirect("/settings/profile");
  }

  const { uuid } = await params;
  const [co, company, warehouses, initialComments, wizard] = await Promise.all([
    getCustomerOrder(uuid),
    getCompanyDefaults(),
    listActiveWarehousesForMobile(),
    listCommentsForEntity("customer_order", uuid),
    getOrderWizard(uuid),
  ]);
  if (!co || !company) notFound();

  const canEdit = hasPermission(user, "customer_orders.create");
  const canSubmit = hasPermission(user, "customer_orders.submit");
  const canApprove = hasPermission(user, "customer_orders.approve");
  const canDirectorApprove = hasPermission(
    user,
    "customer_orders.director_approve",
  );
  const canCreateInvoice = hasPermission(user, "customer_invoices.create");

  const isDraft = co.status === "draft";

  // Drafts spend most of their time being built — the wizard's
  // "do this next" view doesn't have much to project yet, so default
  // to Detail. Every post-submission state defaults to Wizard so the
  // operator lands on the action they need to take.
  const defaultTab: "wizard" | "detail" = isDraft ? "detail" : "wizard";

  // The existing detail content — rendered server-side and handed to
  // CoTabs as a React node. Keeping it server-rendered preserves all
  // the realtime collab wiring on the inner forms.
  const detailContent = (
    <div className="space-y-6">
      <COWorkflowCard
        co={co}
        currentUserId={user.id}
        canEdit={canEdit}
        canSubmit={canSubmit}
        canApprove={canApprove}
        canDirectorApprove={canDirectorApprove}
        canCreateInvoice={canCreateInvoice}
        prefs={company}
      />

      <EditModeToggle canEdit={canEdit && isDraft}>
        <COHeaderCard
          co={co}
          canEdit={canEdit && isDraft}
          warehouses={warehouses}
        />
      </EditModeToggle>

      <COLinesCard co={co} canEdit={canEdit && isDraft} prefs={company} />

      <CommentThread
        entityType="customer_order"
        entityUuid={co.uuid}
        initial={initialComments ?? []}
        canComment={canEdit}
        currentUserId={user.id}
      />

      <AuditMetaSection
        inserted_at={co.inserted_at}
        updated_at={co.updated_at}
        created_by={co.created_by ?? null}
        updated_by={co.updated_by ?? null}
      />
      <AuditHistoryCard entityType="customer_order" entityId={co.id} />
    </div>
  );

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <SalesSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-5xl space-y-6">
          <div>
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <Link href="/sales/orders">
                <ChevronLeft className="mr-1 size-4" />
                Back to orders
              </Link>
            </Button>
          </div>

          <header className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="size-4 text-muted-foreground" />
                  <span className="font-mono text-xs font-semibold text-muted-foreground">
                    {co.code ?? `#${co.id}`}
                  </span>
                  <Badge tone={STATUS_TONE[co.status]}>{STATUS_LABEL[co.status]}</Badge>
                </div>
                <h1 className="truncate text-2xl font-semibold tracking-tight">
                  {co.customer?.name ?? "—"}
                </h1>
                {co.customer_reference && (
                  <p className="text-xs text-muted-foreground">
                    Customer ref: {co.customer_reference}
                  </p>
                )}
              </div>
            </div>
          </header>

          <CoTabs
            coUuid={co.uuid}
            defaultTab={defaultTab}
            wizard={wizard}
            prefs={company}
            detail={detailContent}
          />
        </div>
      </main>
    </div>
  );
}
