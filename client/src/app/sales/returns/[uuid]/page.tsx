import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, PackageCheck } from "lucide-react";
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
import { getCustomerReturn } from "@/lib/customer-returns/server";
import { getCompanyDefaults } from "@/lib/company/server";
import type { CustomerReturnStatus } from "@/lib/types";
import { EditModeToggle } from "@/components/forms/edit-mode-toggle";
import { SalesSubnav } from "../../sales-subnav";
import { RMAHeaderCard } from "./rma-header-card";
import { RMALinesCard } from "./rma-lines-card";
import { RMAWorkflowCard } from "./rma-workflow-card";
import { RMAFilesCard } from "./rma-files-card";
import { RMACreditNoteCard } from "./rma-credit-note-card";

export const metadata = { title: "RMA · Sales · PSP" };

const STATUS_LABEL: Record<CustomerReturnStatus, string> = {
  draft: "Draft",
  received: "Received",
  accepted: "Accepted",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<
  CustomerReturnStatus,
  "emerald" | "amber" | "sky" | "muted" | "destructive"
> = {
  draft: "muted",
  received: "sky",
  accepted: "emerald",
  rejected: "destructive",
  cancelled: "muted",
};

export default async function RMADetailPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "customer_returns.view")) {
    redirect("/settings/profile");
  }

  const { uuid } = await params;
  const [bundle, company, initialComments] = await Promise.all([
    getCustomerReturn(uuid),
    getCompanyDefaults(),
    listCommentsForEntity("customer_return", uuid),
  ]);
  if (!bundle || !company) notFound();

  const { customer_return: rma, credit_note } = bundle;

  const canEdit = hasPermission(user, "customer_returns.create");
  const canReceive = hasPermission(user, "customer_returns.receive");
  const canResolve = hasPermission(user, "customer_returns.resolve");
  const isDraft = rma.status === "draft";

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <SalesSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-5xl space-y-6">
          <div>
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <Link href="/sales/returns">
                <ChevronLeft className="mr-1 size-4" />
                Back to RMAs
              </Link>
            </Button>
          </div>

          <header className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  <PackageCheck className="size-4 text-muted-foreground" />
                  <span className="font-mono text-xs font-semibold text-muted-foreground">
                    {rma.code ?? `#${rma.id}`}
                  </span>
                  <Badge tone={STATUS_TONE[rma.status]}>
                    {STATUS_LABEL[rma.status]}
                  </Badge>
                </div>
                <h1 className="truncate text-2xl font-semibold tracking-tight">
                  {rma.customer?.name ?? "—"}
                </h1>
                {rma.customer_invoice && (
                  <p className="text-xs text-muted-foreground">
                    Against{" "}
                    <Link
                      href={`/sales/invoices/${rma.customer_invoice.uuid}`}
                      className="font-medium text-brand hover:underline"
                    >
                      {rma.customer_invoice.code ?? `Invoice #${rma.customer_invoice.id}`}
                    </Link>
                  </p>
                )}
              </div>
            </div>
          </header>

          <RMAWorkflowCard
            rma={rma}
            canEdit={canEdit}
            canReceive={canReceive}
            canResolve={canResolve}
            prefs={company}
          />

          {credit_note && (
            <RMACreditNoteCard creditNote={credit_note} prefs={company} />
          )}

          <EditModeToggle canEdit={canEdit && isDraft}>
            <RMAHeaderCard rma={rma} canEdit={canEdit && isDraft} />
          </EditModeToggle>

          <RMALinesCard
            rma={rma}
            canEdit={canEdit && isDraft}
            canInspect={canResolve && rma.status === "received"}
            prefs={company}
          />

          <RMAFilesCard
            rma={rma}
            canEdit={canEdit && (rma.status === "draft" || rma.status === "received")}
            canDelete={canEdit && (rma.status === "draft" || rma.status === "received")}
            prefs={company}
          />

          <CommentThread
            entityType="customer_return"
            entityUuid={rma.uuid}
            initial={initialComments ?? []}
            canComment={canEdit}
            currentUserId={user.id}
          />

          <AuditMetaSection
            inserted_at={rma.inserted_at}
            updated_at={rma.updated_at}
            created_by={rma.created_by ?? null}
            updated_by={rma.updated_by ?? null}
          />
          <AuditHistoryCard entityType="customer_return" entityId={rma.id} />
        </div>
      </main>
    </div>
  );
}
