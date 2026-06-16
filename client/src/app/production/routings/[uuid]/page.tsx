import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Route } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge-mini";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getCompanyDefaults } from "@/lib/company/server";
import { getRouting } from "@/lib/production/server";
import { listCommentsForEntity } from "@/lib/comments/server";
import { CommentThread } from "@/components/comments/comment-thread";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { ProductionSubnav } from "../../production-subnav";
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
        <div className="mx-auto max-w-5xl space-y-6">
          <div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
            >
              <Link href="/production/routings">
                <ChevronLeft className="mr-1 size-4" />
                Back to routings
              </Link>
            </Button>
          </div>

          <header className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
                <Route className="size-6 text-brand" />
                {routing.name}
              </h1>
              {!routing.is_active && <Badge tone="muted">Archived</Badge>}
            </div>
            <p className="font-mono text-xs text-muted-foreground">
              {routing.code ?? `#${routing.id}`}
              {routing.item && (
                <>
                  {" "}· Output:{" "}
                  <span className="font-medium text-foreground">
                    {routing.item.name}
                  </span>
                </>
              )}
              {routing.bom && (
                <>
                  {" "}· BOM:{" "}
                  <span className="font-medium text-foreground">
                    {routing.bom.code ?? routing.bom.name}
                  </span>
                </>
              )}
            </p>
          </header>

          <RoutingForm
            routing={routing}
            outputItem={null}
            initialBom={null}
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
        </div>
      </main>
    </div>
  );
}
