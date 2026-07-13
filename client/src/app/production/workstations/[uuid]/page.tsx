import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Settings2 } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Badge } from "@/components/ui/badge-mini";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { PageCursorAnchor } from "@/components/realtime/page-cursor-anchor";
import { PageHeader } from "@/components/layout/page-header";
import { getCompanyDefaults } from "@/lib/company/server";
import { getWorkstation } from "@/lib/production/server";
import { listCommentsForEntity } from "@/lib/comments/server";
import { CommentThread } from "@/components/comments/comment-thread";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { ProductionSubnav } from "../../production-subnav";
import { EditModeToggle } from "@/components/forms/edit-mode-toggle";
import { WorkstationForm } from "../workstation-form";

export const metadata = { title: "Workstation · Production · PSP" };

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ uuid: string }>;
}

export default async function WorkstationDetailPage({ params }: Props) {
  const user = await requireUser();
  if (!hasPermission(user, "production.workstation_view")) {
    redirect("/settings/profile");
  }

  const { uuid } = await params;
  const [ws, company, initialComments] = await Promise.all([
    getWorkstation(uuid),
    getCompanyDefaults(),
    listCommentsForEntity("workstation", uuid),
  ]);
  if (!ws || !company) notFound();

  const canEdit = hasPermission(user, "production.workstation_edit");
  const canDelete = hasPermission(user, "production.workstation_delete");
  const canComment =
    canEdit || hasPermission(user, "production.workstation_create");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <PageCursorAnchor
          pageId={`/production/workstations/${uuid}`}
          className="mx-auto max-w-5xl space-y-6"
          suppressBanner
        >
          <PageHeader
            size="detail"
            icon={Settings2}
            title={
              <>
                <span>{ws.name}</span>
                {!ws.is_active && <Badge tone="muted">Archived</Badge>}
              </>
            }
            description={
              <span className="font-mono text-xs">
                {ws.code ?? `#${ws.id}`}
                {ws.workstation_group && (
                  <>
                    {" "}· Group:{" "}
                    <Link
                      href={`/production/workstation-groups/${ws.workstation_group.uuid}`}
                      className="font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      {ws.workstation_group.name}
                    </Link>
                  </>
                )}
                {ws.warehouse && (
                  <>
                    {" "}· Site:{" "}
                    <Link
                      href={`/settings/warehouses/${ws.warehouse.uuid}`}
                      className="font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      {ws.warehouse.name}
                    </Link>
                  </>
                )}
              </span>
            }
            backHref="/production/workstations"
            backLabel="Back to workstations"
          />

          <EditModeToggle canEdit={canEdit}>
            <WorkstationForm
              workstation={ws}
              company={company}
              canEdit={canEdit}
              canDelete={canDelete}
            />
          </EditModeToggle>

          <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
            <header className="mb-3">
              <h2 className="text-sm font-semibold tracking-tight">
                Discussion
              </h2>
            </header>
            <CommentThread
              entityType="workstation"
              entityUuid={ws.uuid}
              initial={initialComments ?? []}
              canComment={canComment}
              currentUserId={user.id}
            />
          </section>

          <AuditMetaSection
            inserted_at={ws.inserted_at}
            updated_at={ws.updated_at}
            created_by={ws.created_by}
            updated_by={ws.updated_by}
          />
          <AuditHistoryCard
            entityType="workstation"
            entityId={ws.id}
            canRestore={false}
          />
        </PageCursorAnchor>
      </main>
    </div>
  );
}
