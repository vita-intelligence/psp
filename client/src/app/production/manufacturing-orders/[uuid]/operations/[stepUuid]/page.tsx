import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { PageCursorAnchor } from "@/components/realtime/page-cursor-anchor";
import {
  getManufacturingOrder,
  getManufacturingOrderStep,
} from "@/lib/production/server";
import { listCommentsForEntity } from "@/lib/comments/server";
import { CommentThread } from "@/components/comments/comment-thread";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { ProductionSubnav } from "../../../../production-subnav";
import { MOStepForm } from "./mo-step-form";

export const metadata = { title: "Modify operation · Production · PSP" };

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ uuid: string; stepUuid: string }>;
}

export default async function ModifyOperationPage({ params }: Props) {
  const user = await requireUser();
  if (!hasPermission(user, "production.mo_view")) {
    redirect("/settings/profile");
  }

  const { uuid, stepUuid } = await params;

  const [mo, step, initialComments] = await Promise.all([
    getManufacturingOrder(uuid),
    getManufacturingOrderStep(uuid, stepUuid),
    listCommentsForEntity("manufacturing_order_step", stepUuid),
  ]);
  if (!mo || !step) notFound();

  const canEdit = hasPermission(user, "production.mo_edit");
  const canExecute = hasPermission(user, "production.mo_execute");
  const canComment = canEdit || canExecute;

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <PageCursorAnchor
          pageId={`/production/manufacturing-orders/${uuid}/operations/${stepUuid}`}
          className="mx-auto max-w-5xl space-y-6"
        >
          <div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
            >
              <Link href={`/production/manufacturing-orders/${mo.uuid}`}>
                <ChevronLeft className="mr-1 size-4" />
                Back to {mo.code ?? "MO"}
              </Link>
            </Button>
          </div>

          <header className="space-y-1">
            <p className="font-mono text-[11px] text-muted-foreground">
              {mo.code ?? `#${mo.id}`} · op {step.sort_order + 1}
              {step.workstation_group ? (
                <>
                  {" "}·{" "}
                  <span className="font-medium text-foreground">
                    {step.workstation_group.name}
                  </span>
                </>
              ) : null}
            </p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Modify operation
            </h1>
          </header>

          <MOStepForm
            step={step}
            canEdit={canEdit}
            canExecute={canExecute}
          />

          <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
            <header className="mb-3">
              <h2 className="text-sm font-semibold tracking-tight">
                Discussion
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Per-operation thread for ops / quality / planner back-and-forth.
              </p>
            </header>
            <CommentThread
              entityType="manufacturing_order_step"
              entityUuid={step.uuid}
              initial={initialComments ?? []}
              canComment={canComment}
              currentUserId={user.id}
            />
          </section>

          <AuditMetaSection
            inserted_at={step.inserted_at}
            updated_at={step.updated_at}
            created_by={step.created_by}
            updated_by={step.updated_by}
          />
          <AuditHistoryCard
            entityType="manufacturing_order_step"
            entityId={step.id}
            canRestore={false}
          />
        </PageCursorAnchor>
      </main>
    </div>
  );
}
