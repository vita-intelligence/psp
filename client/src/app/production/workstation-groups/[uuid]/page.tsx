import { notFound, redirect } from "next/navigation";
import { Factory } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Badge } from "@/components/ui/badge-mini";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { PageHeader } from "@/components/layout/page-header";
import { getCompanyDefaults } from "@/lib/company/server";
import { getWorkstationGroup } from "@/lib/production/server";
import { listCommentsForEntity } from "@/lib/comments/server";
import { CommentThread } from "@/components/comments/comment-thread";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { ProductionSubnav } from "../../production-subnav";
import { EditModeToggle } from "@/components/forms/edit-mode-toggle";
import { WorkstationGroupForm } from "../workstation-group-form";

export const metadata = {
  title: "Workstation group · Production · PSP",
};

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ uuid: string }>;
}

export default async function WorkstationGroupDetailPage({ params }: Props) {
  const user = await requireUser();
  if (!hasPermission(user, "production.workstation_group_view")) {
    redirect("/settings/profile");
  }

  const { uuid } = await params;
  const [group, company, initialComments] = await Promise.all([
    getWorkstationGroup(uuid),
    getCompanyDefaults(),
    listCommentsForEntity("workstation_group", uuid),
  ]);
  if (!group || !company) notFound();

  const canEdit = hasPermission(user, "production.workstation_group_edit");
  const canDelete = hasPermission(user, "production.workstation_group_delete");
  const canComment =
    canEdit || hasPermission(user, "production.workstation_group_create");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-5xl space-y-6">
          <PageHeader
            size="detail"
            icon={Factory}
            title={
              <>
                <span>{group.name}</span>
                {!group.is_active && <Badge tone="muted">Archived</Badge>}
              </>
            }
            description={
              <span className="font-mono text-xs">
                {group.code ?? `#${group.id}`}
              </span>
            }
            backHref="/production/workstation-groups"
            backLabel="Back to workstation groups"
          />

          <EditModeToggle canEdit={canEdit}>
            <WorkstationGroupForm
              group={group}
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
              entityType="workstation_group"
              entityUuid={group.uuid}
              initial={initialComments ?? []}
              canComment={canComment}
              currentUserId={user.id}
            />
          </section>

          <AuditMetaSection
            inserted_at={group.inserted_at}
            updated_at={group.updated_at}
            created_by={group.created_by}
            updated_by={group.updated_by}
          />
          <AuditHistoryCard
            entityType="workstation_group"
            entityId={group.id}
            canRestore={false}
          />
        </div>
      </main>
    </div>
  );
}
