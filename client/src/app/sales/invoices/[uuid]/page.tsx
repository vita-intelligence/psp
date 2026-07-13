import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FileDown, Receipt } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { RecordHero } from "@/components/layout/record-hero";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { PageCursorAnchor } from "@/components/realtime/page-cursor-anchor";
import { Badge } from "@/components/ui/badge-mini";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { CommentThread } from "@/components/comments/comment-thread";
import { listCommentsForEntity } from "@/lib/comments/server";
import { getCustomerInvoice } from "@/lib/customer-invoices/server";
import { getCompanyDefaults } from "@/lib/company/server";
import type { CustomerInvoiceStatus } from "@/lib/types";
import { EditModeToggle } from "@/components/forms/edit-mode-toggle";
import { SalesSubnav } from "../../sales-subnav";
import { InvoiceHeaderCard } from "./invoice-header-card";
import { InvoiceLinesCard } from "./invoice-lines-card";
import { InvoicePaymentsCard } from "./invoice-payments-card";
import { InvoiceWorkflowCard } from "./invoice-workflow-card";

export const metadata = { title: "Invoice · Sales · PSP" };

const STATUS_LABEL: Record<CustomerInvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  partially_paid: "Partially paid",
  paid: "Paid",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<
  CustomerInvoiceStatus,
  "emerald" | "amber" | "sky" | "muted" | "destructive"
> = {
  draft: "muted",
  sent: "amber",
  partially_paid: "sky",
  paid: "emerald",
  cancelled: "destructive",
};

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "customer_invoices.view")) {
    redirect("/settings/profile");
  }

  const { uuid } = await params;
  const [inv, company, initialComments] = await Promise.all([
    getCustomerInvoice(uuid),
    getCompanyDefaults(),
    listCommentsForEntity("customer_invoice", uuid),
  ]);
  if (!inv || !company) notFound();

  const canEdit = hasPermission(user, "customer_invoices.create");
  const canSend = hasPermission(user, "customer_invoices.send");
  const canRecordPayment = hasPermission(user, "customer_invoices.record_payment");
  const isDraft = inv.status === "draft";

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <SalesSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <PageCursorAnchor
          pageId={`/sales/invoices/${uuid}`}
          className="mx-auto max-w-5xl space-y-6"
        >
          <RecordHero
            icon={Receipt}
            code={inv.code ?? `#${inv.id}`}
            chips={
              <Badge tone={STATUS_TONE[inv.status]}>
                {STATUS_LABEL[inv.status]}
              </Badge>
            }
            title={
              inv.customer?.uuid ? (
                <Link
                  href={`/sales/customers/${inv.customer.uuid}`}
                  className="underline-offset-2 hover:underline"
                >
                  {inv.customer.name}
                </Link>
              ) : (
                inv.customer?.name ?? "—"
              )
            }
            subtitle={
              inv.customer_order ? (
                <p className="text-xs text-muted-foreground">
                  From{" "}
                  <Link
                    href={`/sales/orders/${inv.customer_order.uuid}`}
                    className="font-medium text-brand hover:underline"
                  >
                    {inv.customer_order.code ?? `CO #${inv.customer_order.id}`}
                  </Link>
                </p>
              ) : undefined
            }
            actions={
              <Button asChild size="sm" variant="outline">
                <a
                  href={`/api/customer-invoices/${inv.uuid}/documents/pdf`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <FileDown className="mr-1.5 size-3.5" />
                  PDF
                </a>
              </Button>
            }
            backHref="/sales/invoices"
            backLabel="Back to invoices"
          />

          <InvoiceWorkflowCard
            invoice={inv}
            canEdit={canEdit}
            canSend={canSend}
            prefs={company}
            pageId={`/sales/invoices/${uuid}`}
          />

          <EditModeToggle canEdit={canEdit && isDraft}>
            <InvoiceHeaderCard
              invoice={inv}
              canEdit={canEdit && isDraft}
            />
          </EditModeToggle>

          <InvoiceLinesCard
            invoice={inv}
            canEdit={canEdit && isDraft}
            prefs={company}
          />

          <InvoicePaymentsCard
            invoice={inv}
            canRecordPayment={canRecordPayment}
            prefs={company}
            pageId={`/sales/invoices/${uuid}`}
          />

          <CommentThread
            entityType="customer_invoice"
            entityUuid={inv.uuid}
            initial={initialComments ?? []}
            canComment={canEdit}
            currentUserId={user.id}
          />

          <AuditMetaSection
            inserted_at={inv.inserted_at}
            updated_at={inv.updated_at}
            created_by={inv.created_by ?? null}
            updated_by={inv.updated_by ?? null}
          />
          <AuditHistoryCard entityType="customer_invoice" entityId={inv.id} />
        </PageCursorAnchor>
      </main>
    </div>
  );
}
