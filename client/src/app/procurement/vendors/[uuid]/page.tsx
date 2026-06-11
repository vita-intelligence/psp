import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Users } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { Badge } from "@/components/ui/badge-mini";
import { getVendor, listVendorPriceHistory } from "@/lib/vendors/server";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { CommentThread } from "@/components/comments/comment-thread";
import { listCommentsForEntity } from "@/lib/comments/server";
import { ProcurementSubnav } from "../../procurement-subnav";
import { VendorForm } from "../vendor-form";
import { VendorApprovalCard } from "./vendor-approval-card";
import { VendorQualificationCard } from "./vendor-qualification-card";
import { VendorApprovedItemsCard } from "./vendor-approved-items-card";
import { VendorCertificatesCard } from "./vendor-certificates-card";
import { VendorPriceHistoryCard } from "./vendor-price-history-card";
import type { VendorApprovalStatus } from "@/lib/types";
import { listItemsForReceive } from "@/lib/stock/server";
import { listCertificatesForPicker } from "@/lib/certificates/server";

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
  const [vendor, items, certs, initialComments, priceHistory] = await Promise.all([
    getVendor(uuid),
    listItemsForReceive(),
    listCertificatesForPicker(),
    listCommentsForEntity("vendor", uuid),
    listVendorPriceHistory(uuid),
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
        <div className="mx-auto max-w-5xl space-y-6">
          <div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
            >
              <Link href="/procurement/vendors">
                <ChevronLeft className="mr-1 size-4" />
                Back to vendors
              </Link>
            </Button>
          </div>

          <header className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Users className="size-4 text-muted-foreground" />
                  <span className="font-mono text-xs font-semibold text-muted-foreground">
                    {vendor.code ?? `#${vendor.id}`}
                  </span>
                  <Badge tone={APPROVAL_TONE[vendor.approval_status]}>
                    {APPROVAL_LABEL[vendor.approval_status]}
                  </Badge>
                </div>
                <h1 className="truncate text-2xl font-semibold tracking-tight">
                  {vendor.name}
                </h1>
                {vendor.legal_name && vendor.legal_name !== vendor.name && (
                  <p className="text-sm text-muted-foreground">
                    {vendor.legal_name}
                  </p>
                )}
              </div>
            </div>
          </header>

          <VendorApprovalCard vendor={vendor} canApprove={canApprove} />

          <VendorQualificationCard vendor={vendor} canEdit={canEdit} />

          <VendorForm vendor={vendor} canEdit={canEdit} />

          <CommentThread
            entityType="vendor"
            entityUuid={vendor.uuid}
            initial={initialComments ?? []}
            canComment={canEdit}
            currentUserId={user.id}
          />

          <VendorApprovedItemsCard
            vendor={vendor}
            items={items ?? []}
            canEdit={canEdit}
          />

          <VendorCertificatesCard
            vendor={vendor}
            certificates={certs ?? []}
            canEdit={canEdit}
          />

          <VendorPriceHistoryCard rows={priceHistory} />

          <AuditMetaSection
            inserted_at={vendor.inserted_at}
            updated_at={vendor.updated_at}
            created_by={vendor.created_by ?? null}
            updated_by={vendor.updated_by ?? null}
          />
          <AuditHistoryCard entityType="vendor" entityId={vendor.id} />
        </div>
      </main>
    </div>
  );
}
