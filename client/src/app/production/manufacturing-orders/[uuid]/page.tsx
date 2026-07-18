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
import { MOSessionsCard } from "@/components/production/mo-sessions-card";
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

  // Sessions are attributed via mo.id (integer FK), not the uuid,
  // so this fetch has to run after the MO resolves rather than in
  // parallel with it.
  const initialSessions = await listMOSessions(mo.id);

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
          className="mx-auto max-w-6xl space-y-6"
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
        </PageCursorAnchor>
      </main>
    </div>
  );
}
