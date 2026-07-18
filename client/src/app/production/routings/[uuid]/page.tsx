import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Route } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Badge } from "@/components/ui/badge-mini";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { PageCursorAnchor } from "@/components/realtime/page-cursor-anchor";
import { PageHeader } from "@/components/layout/page-header";
import { getCompanyDefaults } from "@/lib/company/server";
import { getRouting } from "@/lib/production/server";
import { listCommentsForEntity } from "@/lib/comments/server";
import { CommentThread } from "@/components/comments/comment-thread";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { ProductionSubnav } from "../../production-subnav";
import { EditModeToggle } from "@/components/forms/edit-mode-toggle";
import { RoutingForm } from "../routing-form";

export const metadata = { title: "Routing · Production · PSP" };

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ uuid: string }>;
}

export default async function RoutingDetailPage({ params }: Props) {
  const user = await requireUser();
  if (!hasPermission(user, "production.routing_view")) {
    redirect("/settings/profile");
  }

  const { uuid } = await params;
  const [routing, company, initialComments] = await Promise.all([
    getRouting(uuid),
    getCompanyDefaults(),
    listCommentsForEntity("routing", uuid),
  ]);
  if (!routing || !company) notFound();

  const canEdit = hasPermission(user, "production.routing_edit");
  const canDelete = hasPermission(user, "production.routing_delete");
  const canComment =
    canEdit || hasPermission(user, "production.routing_create");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <PageCursorAnchor
          pageId={`/production/routings/${uuid}`}
          className="mx-auto max-w-5xl space-y-6"
          suppressBanner
        >
          <PageHeader
            size="detail"
            icon={Route}
            title={
              <>
                <span>{routing.name}</span>
                {!routing.is_active && <Badge tone="muted">Archived</Badge>}
              </>
            }
            description={
              <span className="font-mono text-xs">
                {routing.code ?? `#${routing.id}`}
                {routing.item && (
                  <>
                    {" "}· Output:{" "}
                    <Link
                      href={`/production/items/${routing.item.uuid}`}
                      className="font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      {routing.item.name}
                    </Link>
                  </>
                )}
                {routing.bom && (
                  <>
                    {" "}· BOM:{" "}
                    <Link
                      href={`/production/boms/${routing.bom.uuid}`}
                      className="font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      {routing.bom.code ?? routing.bom.name}
                    </Link>
                  </>
                )}
              </span>
            }
            backHref="/production/routings"
            backLabel="Back to routings"
          />

          <EditModeToggle canEdit={canEdit}>
            <RoutingForm
              routing={routing}
              outputItem={null}
              initialBom={null}
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
              entityType="routing"
              entityUuid={routing.uuid}
              initial={initialComments ?? []}
              canComment={canComment}
              currentUserId={user.id}
            />
          </section>

          <AuditMetaSection
            inserted_at={routing.inserted_at}
            updated_at={routing.updated_at}
            created_by={routing.created_by}
            updated_by={routing.updated_by}
          />
          <AuditHistoryCard
            entityType="routing"
            entityId={routing.id}
            canRestore={false}
          />
        </PageCursorAnchor>
      </main>
    </div>
  );
}
