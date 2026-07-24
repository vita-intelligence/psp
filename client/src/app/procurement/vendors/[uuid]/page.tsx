import { notFound, redirect } from "next/navigation";
import { Users } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { RecordHero } from "@/components/layout/record-hero";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { PageCursorAnchor } from "@/components/realtime/page-cursor-anchor";
import { Badge } from "@/components/ui/badge-mini";
import { getVendor, listVendorPriceHistory } from "@/lib/vendors/server";
import { listVendorPurchaseTerms } from "@/lib/purchase-terms";
import { getCompanyDefaults } from "@/lib/company/server";
import { listUnitsOfMeasurement } from "@/lib/units/server";
import { VendorPurchaseTermsCard } from "./vendor-purchase-terms-card";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { CommentThread } from "@/components/comments/comment-thread";
import { listCommentsForEntity } from "@/lib/comments/server";
import { ProcurementSubnav } from "../../procurement-subnav";
import { EditModeToggle } from "@/components/forms/edit-mode-toggle";
import { VendorForm } from "../vendor-form";
import { VendorApprovalCard } from "./vendor-approval-card";
import { VendorQualificationCard } from "./vendor-qualification-card";
import { VendorApprovedItemsCard } from "./vendor-approved-items-card";
import { VendorCertificatesCard } from "./vendor-certificates-card";
import { VendorPriceHistoryCard } from "./vendor-price-history-card";
import type { VendorApprovalStatus } from "@/lib/types";

export const metadata = { title: "Vendor · Procurement · PSP" };

const APPROVAL_TONE: Record<
  VendorApprovalStatus,
  "emerald" | "amber" | "muted" | "destructive"
> = {
  approved: "emerald",
  pending: "amber",
  suspended: "muted",
  rejected: "destructive",
};

const APPROVAL_LABEL: Record<VendorApprovalStatus, string> = {
  approved: "Approved",
  pending: "Pending",
  suspended: "Suspended",
  rejected: "Rejected",
};

export default async function VendorDetailPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "vendors.view")) {
    redirect("/settings/profile");
  }

  const { uuid } = await params;
  // Items + certificate registries are fetched on-demand by the
  // SearchPicker inside each card, so we skip the bulk lists here.
  const [
    vendor,
    initialComments,
    priceHistory,
    purchaseTerms,
    prefs,
    units,
  ] = await Promise.all([
    getVendor(uuid),
    listCommentsForEntity("vendor", uuid),
    listVendorPriceHistory(uuid),
    listVendorPurchaseTerms(uuid),
    getCompanyDefaults(),
    // Purchase-term modal's ``Min qty UoM`` dropdown reads from the
    // company's UoM registry so the operator can only pick a unit
    // that actually exists in settings. Restrict to the dimensions
    // that make sense for purchasing: mass / volume / count.
    listUnitsOfMeasurement(),
  ]);
  if (!vendor) notFound();

  const canEdit = hasPermission(user, "vendors.edit");
  const canApprove = hasPermission(user, "vendors.approve");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProcurementSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <PageCursorAnchor
          pageId={`/procurement/vendors/${uuid}`}
          className="mx-auto max-w-5xl space-y-6"
        >
          <RecordHero
            icon={Users}
            code={vendor.code ?? `#${vendor.id}`}
            chips={
              <Badge tone={APPROVAL_TONE[vendor.approval_status]}>
                {APPROVAL_LABEL[vendor.approval_status]}
              </Badge>
            }
            title={vendor.name}
            subtitle={
              vendor.legal_name && vendor.legal_name !== vendor.name
                ? vendor.legal_name
                : undefined
            }
            backHref="/procurement/vendors"
            backLabel="Back to vendors"
          />

          <VendorApprovalCard
            vendor={vendor}
            canApprove={canApprove}
            pageId={`/procurement/vendors/${uuid}`}
          />

          <VendorQualificationCard
            vendor={vendor}
            canEdit={canEdit}
            pageId={`/procurement/vendors/${uuid}`}
          />

          <EditModeToggle canEdit={canEdit}>
            <VendorForm vendor={vendor} canEdit={canEdit} />
          </EditModeToggle>

          <CommentThread
            entityType="vendor"
            entityUuid={vendor.uuid}
            initial={initialComments ?? []}
            canComment={canEdit}
            currentUserId={user.id}
          />

          <VendorApprovedItemsCard vendor={vendor} canEdit={canEdit} />

          {prefs && (
            <VendorPurchaseTermsCard
              vendor={vendor}
              terms={purchaseTerms}
              prefs={prefs}
              units={units ?? []}
              canEdit={canEdit}
            />
          )}

          <VendorCertificatesCard vendor={vendor} canEdit={canEdit} />

          <VendorPriceHistoryCard rows={priceHistory} />

          <AuditMetaSection
            inserted_at={vendor.inserted_at}
            updated_at={vendor.updated_at}
            created_by={vendor.created_by ?? null}
            updated_by={vendor.updated_by ?? null}
          />
          <AuditHistoryCard entityType="vendor" entityId={vendor.id} />
        </PageCursorAnchor>
      </main>
    </div>
  );
}
