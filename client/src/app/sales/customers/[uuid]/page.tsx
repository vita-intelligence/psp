import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Users } from "lucide-react";
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
import { getCustomer } from "@/lib/customers/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { listUsersFirstPage } from "@/lib/users/server";
import { listPricelistsForPicker } from "@/lib/pricelists/server";
import {
  getCustomerCredits,
  listLoyaltyPrograms,
} from "@/lib/loyalty/server";
import type { CustomerApprovalStatus, CustomerStatus } from "@/lib/types";
import { EditModeToggle } from "@/components/forms/edit-mode-toggle";
import { SalesSubnav } from "../../sales-subnav";
import { CustomerForm } from "../customer-form";
import { CustomerOnboardingCard } from "./customer-onboarding-card";
import { CustomerApprovedItemsCard } from "./customer-approved-items-card";
import { CustomerCreditsCard } from "./customer-credits-card";
import { CustomerContactsCard } from "./customer-contacts-card";
import { CustomerContactEventsCard } from "./customer-contact-events-card";
import { CustomerFilesCard } from "./customer-files-card";

export const metadata = { title: "Customer · Sales · PSP" };

const APPROVAL_TONE: Record<
  CustomerApprovalStatus,
  "emerald" | "amber" | "muted" | "destructive"
> = {
  approved: "emerald",
  draft: "amber",
  suspended: "muted",
  rejected: "destructive",
};

const APPROVAL_LABEL: Record<CustomerApprovalStatus, string> = {
  approved: "Approved",
  draft: "Draft",
  suspended: "Suspended",
  rejected: "Rejected",
};

const STATUS_LABEL: Record<CustomerStatus, string> = {
  lead: "Lead",
  prospect: "Prospect",
  active: "Active",
  dormant: "Dormant",
  inactive: "Inactive",
};

const STATUS_TONE: Record<
  CustomerStatus,
  "emerald" | "amber" | "sky" | "muted" | "destructive"
> = {
  lead: "sky",
  prospect: "amber",
  active: "emerald",
  dormant: "muted",
  inactive: "destructive",
};

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "customers.view")) {
    redirect("/settings/profile");
  }

  const { uuid } = await params;
  const [
    customer,
    company,
    userList,
    pricelists,
    loyaltyPrograms,
    initialCredits,
    initialComments,
  ] = await Promise.all([
    getCustomer(uuid),
    getCompanyDefaults(),
    listUsersFirstPage(100),
    listPricelistsForPicker(),
    listLoyaltyPrograms(),
    getCustomerCredits(uuid),
    listCommentsForEntity("customer", uuid),
  ]);
  if (!customer || !company) notFound();

  const canEdit = hasPermission(user, "customers.edit");
  const canApprove = hasPermission(user, "customers.approve");
  const canDelete = hasPermission(user, "customers.delete");
  const canGrantCredit = hasPermission(user, "loyalty.credits_grant");
  const canViewLoyalty = hasPermission(user, "loyalty.view");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <SalesSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-5xl space-y-6">
          <div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
            >
              <Link href="/sales/customers">
                <ChevronLeft className="mr-1 size-4" />
                Back to customers
              </Link>
            </Button>
          </div>

          <header className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Users className="size-4 text-muted-foreground" />
                  <span className="font-mono text-xs font-semibold text-muted-foreground">
                    {customer.code ?? `#${customer.id}`}
                  </span>
                  <Badge tone={STATUS_TONE[customer.status]}>
                    {STATUS_LABEL[customer.status]}
                  </Badge>
                  <span
                    title={
                      customer.effective_approval_reason ===
                      "re_qualification_overdue"
                        ? "Re-qualification overdue"
                        : customer.effective_approval_reason === "inactive"
                          ? "Customer is inactive"
                          : undefined
                    }
                  >
                    <Badge
                      tone={APPROVAL_TONE[customer.effective_approval_status]}
                    >
                      {APPROVAL_LABEL[customer.effective_approval_status]}
                      {customer.effective_approval_reason !== "none" && " *"}
                    </Badge>
                  </span>
                </div>
                <h1 className="truncate text-2xl font-semibold tracking-tight">
                  {customer.name}
                </h1>
                {customer.legal_name && customer.legal_name !== customer.name && (
                  <p className="text-sm text-muted-foreground">
                    {customer.legal_name}
                  </p>
                )}
                {customer.account_manager && (
                  <p className="text-xs text-muted-foreground">
                    Account manager:{" "}
                    <span className="font-medium text-foreground">
                      {customer.account_manager.name}
                    </span>
                  </p>
                )}
              </div>
            </div>
          </header>

          <CustomerOnboardingCard
            customer={customer}
            canEdit={canEdit}
            canApprove={canApprove}
            currentUserId={user.id}
            prefs={company}
          />

          <EditModeToggle canEdit={canEdit}>
            <CustomerForm
              customer={customer}
              company={company}
              users={userList.items}
              pricelists={pricelists ?? []}
              availablePrograms={
                (loyaltyPrograms ?? []).filter(
                  (p) =>
                    p.is_active ||
                    p.id === (customer.loyalty_program_id ?? -1),
                )
              }
              canEdit={canEdit}
            />
          </EditModeToggle>

          <CustomerApprovedItemsCard customer={customer} canEdit={canEdit} />

          {canViewLoyalty && (
            <CustomerCreditsCard
              customer={customer}
              prefs={company}
              initial={initialCredits}
              programs={loyaltyPrograms ?? []}
              canGrant={canGrantCredit}
            />
          )}

          <CustomerContactsCard customer={customer} canEdit={canEdit} />

          <CustomerContactEventsCard
            customer={customer}
            canEdit={canEdit}
            prefs={company}
          />

          <CustomerFilesCard
            customer={customer}
            canEdit={canEdit}
            canDelete={canDelete}
            prefs={company}
          />

          <CommentThread
            entityType="customer"
            entityUuid={customer.uuid}
            initial={initialComments ?? []}
            canComment={canEdit}
            currentUserId={user.id}
          />

          <AuditMetaSection
            inserted_at={customer.inserted_at}
            updated_at={customer.updated_at}
            created_by={customer.created_by ?? null}
            updated_by={customer.updated_by ?? null}
          />
          <AuditHistoryCard entityType="customer" entityId={customer.id} />
        </div>
      </main>
    </div>
  );
}
