import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Factory } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { PageCursorAnchor } from "@/components/realtime/page-cursor-anchor";
import { PageHeader } from "@/components/layout/page-header";
import { getCompanyDefaults } from "@/lib/company/server";
import { getManufacturingOrder, listMOSessions } from "@/lib/production/server";
import { getMOCostBreakdown } from "@/lib/production/mo-cost";
import { MOSessionsCard } from "@/components/production/mo-sessions-card";
import { MoStepperFromMo } from "@/components/production/mo-stage-stepper";
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
  // Sessions endpoint now accepts either mo.id OR mo.uuid — all four
  // fetches run in one Promise.all instead of the previous two-hop
  // waterfall (mo → then sessions/cost using mo.id). Trims one
  // round-trip off every MO detail page load.
  const [mo, company, initialComments, initialSessions, initialCost] =
    await Promise.all([
      getManufacturingOrder(uuid),
      getCompanyDefaults(),
      listCommentsForEntity("manufacturing_order", uuid),
      listMOSessions(uuid),
      getMOCostBreakdown(uuid),
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
        <PageCursorAnchor
          pageId={`/production/manufacturing-orders/${uuid}`}
          className="mx-auto max-w-7xl space-y-6"
        >
          <PageHeader
            size="detail"
            icon={Factory}
            title={
              mo.item ? (
                <Link
                  href={`/production/items/${mo.item.uuid}`}
                  className="underline-offset-4 hover:underline"
                >
                  {mo.item.name}
                </Link>
              ) : (
                "Manufacturing order"
              )
            }
            description={
              <span className="font-mono text-xs">
                {mo.code ?? `#${mo.id}`}
                {mo.warehouse && (
                  <>
                    {" "}· Site:{" "}
                    <Link
                      href={`/settings/warehouses/${mo.warehouse.uuid}`}
                      className="font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      {mo.warehouse.name}
                    </Link>
                  </>
                )}
                {mo.bom && (
                  <>
                    {" "}· BOM:{" "}
                    <Link
                      href={`/production/boms/${mo.bom.uuid}`}
                      className="font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      {mo.bom.code ?? mo.bom.name}
                    </Link>
                  </>
                )}
              </span>
            }
            backHref="/production/manufacturing-orders"
            backLabel="Back to manufacturing orders"
          />

          {/* 8-stage macro stepper — the operator's "where am I on
              this MO right now?" surface. Sits above the status
              actions card so the answer is visible before any
              button. Server derives the stage from status +
              pickup / production / QC / closeout timestamps in
              ``Backend.Production.mo_stage/1``. */}
          <div className="rounded-lg border bg-card p-3">
            <MoStepperFromMo mo={mo} />
          </div>

          <MOStatusActions
            mo={mo}
            canPrepare={canPrepare}
            canApprove={canApprove}
            canExecute={canExecute}
            canEdit={canEdit}
            currentUserId={user.id}
            company={company}
            pageId={`/production/manufacturing-orders/${uuid}`}
          />

          {/* Production sessions surface immediately after the status
              actions so an operator monitoring the floor sees the
              live timeline without hunting down the page — matches
              the "no cutting corners" placement brief. Realtime
              broadcasts refresh it in <250ms without a page reload. */}
          <MOSessionsCard
            moUuid={mo.uuid}
            initialSessions={initialSessions}
            prefs={company}
          />

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

          <MOCostSummary mo={mo} company={company} initialCost={initialCost} />
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
        </PageCursorAnchor>
      </main>
    </div>
  );
}
