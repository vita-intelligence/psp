import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Factory } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getCompanyDefaults } from "@/lib/company/server";
import { getManufacturingOrder } from "@/lib/production/server";
import { listCommentsForEntity } from "@/lib/comments/server";
import { CommentThread } from "@/components/comments/comment-thread";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { EditModeToggle } from "@/components/forms/edit-mode-toggle";
import { ProductionSubnav } from "../../production-subnav";
import { ManufacturingOrderForm } from "../mo-form";
import { MOStatusActions } from "../mo-status-actions";
import { MOCostSummary } from "../mo-cost-summary";
import { MOPartsTable } from "../mo-parts-table";
import { MOOperationsTable } from "../mo-operations-table";
import {
  MOParentBreadcrumb,
} from "../mo-sub-production";
import { MOChainRoadmap } from "../mo-chain-roadmap";

export const metadata = { title: "Manufacturing order · Production · PSP" };

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ uuid: string }>;
}

export default async function ManufacturingOrderDetailPage({ params }: Props) {
  const user = await requireUser();
  if (!hasPermission(user, "production.mo_view")) {
    redirect("/settings/profile");
  }

  const { uuid } = await params;
  const [mo, company, initialComments] = await Promise.all([
    getManufacturingOrder(uuid),
    getCompanyDefaults(),
    listCommentsForEntity("manufacturing_order", uuid),
  ]);
  if (!mo || !company) notFound();

  const canEdit = hasPermission(user, "production.mo_edit");
  const canDelete = hasPermission(user, "production.mo_delete");
  const canPrepare = hasPermission(user, "production.mo_prepare");
  const canApprove = hasPermission(user, "production.mo_approve");
  const canExecute = hasPermission(user, "production.mo_execute");
  const canComment =
    canEdit || hasPermission(user, "production.mo_create");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-6xl space-y-6">
          <div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
            >
              <Link href="/production/manufacturing-orders">
                <ChevronLeft className="mr-1 size-4" />
                Back to manufacturing orders
              </Link>
            </Button>
          </div>

          <header className="space-y-2">
            <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              <Factory className="size-6 text-brand" />
              {mo.item ? mo.item.name : "Manufacturing order"}
            </h1>
            <p className="font-mono text-xs text-muted-foreground">
              {mo.code ?? `#${mo.id}`}
              {mo.warehouse && (
                <>
                  {" "}· Site:{" "}
                  <span className="font-medium text-foreground">
                    {mo.warehouse.name}
                  </span>
                </>
              )}
              {mo.bom && (
                <>
                  {" "}· BOM:{" "}
                  <span className="font-medium text-foreground">
                    {mo.bom.code ?? mo.bom.name}
                  </span>
                </>
              )}
            </p>
            <MOStatusActions
              mo={mo}
              canPrepare={canPrepare}
              canApprove={canApprove}
              canExecute={canExecute}
              canEdit={canEdit}
              currentUserId={user.id}
              company={company}
            />
          </header>

          <MOParentBreadcrumb mo={mo} />

          <MOChainRoadmap mo={mo} company={company} />

          <EditModeToggle canEdit={canEdit}>
            <ManufacturingOrderForm
              mo={mo}
              company={company}
              canEdit={canEdit}
              canDelete={canDelete}
            />
          </EditModeToggle>

          <MOCostSummary mo={mo} company={company} />
          <MOPartsTable mo={mo} company={company} canEdit={canEdit} />
          <MOOperationsTable mo={mo} company={company} canEdit={canEdit} />

          <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
            <header className="mb-3">
              <h2 className="text-sm font-semibold tracking-tight">
                Discussion
              </h2>
            </header>
            <CommentThread
              entityType="manufacturing_order"
              entityUuid={mo.uuid}
              initial={initialComments ?? []}
              canComment={canComment}
              currentUserId={user.id}
            />
          </section>

          <AuditMetaSection
            inserted_at={mo.inserted_at}
            updated_at={mo.updated_at}
            created_by={mo.created_by}
            updated_by={mo.updated_by}
          />
          <AuditHistoryCard
            entityType="manufacturing_order"
            entityId={mo.id}
            canRestore={false}
          />
        </div>
      </main>
    </div>
  );
}
