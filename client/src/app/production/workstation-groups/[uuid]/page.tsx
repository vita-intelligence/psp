import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Factory } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge-mini";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getCompanyDefaults } from "@/lib/company/server";
import { getWorkstationGroup } from "@/lib/production/server";
import { listCommentsForEntity } from "@/lib/comments/server";
import { CommentThread } from "@/components/comments/comment-thread";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { ProductionSubnav } from "../../production-subnav";
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
        <div className="mx-auto max-w-3xl space-y-6">
          <div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
            >
              <Link href="/production/workstation-groups">
                <ChevronLeft className="mr-1 size-4" />
                Back to workstation groups
              </Link>
            </Button>
          </div>

          <header className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
                <Factory className="size-6 text-brand" />
                {group.name}
              </h1>
              {!group.is_active && <Badge tone="muted">Archived</Badge>}
            </div>
            <p className="font-mono text-xs text-muted-foreground">
              {group.code ?? `#${group.id}`}
            </p>
          </header>

          <WorkstationGroupForm
            group={group}
            company={company}
            canEdit={canEdit}
            canDelete={canDelete}
          />

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
