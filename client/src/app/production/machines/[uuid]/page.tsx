import { notFound, redirect } from "next/navigation";
import { Wrench } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Badge } from "@/components/ui/badge-mini";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { PageCursorAnchor } from "@/components/realtime/page-cursor-anchor";
import { PageHeader } from "@/components/layout/page-header";
import { getCompanyDefaults } from "@/lib/company/server";
import { getMachine } from "@/lib/production/server";
import { listCommentsForEntity } from "@/lib/comments/server";
import { CommentThread } from "@/components/comments/comment-thread";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { ProductionSubnav } from "../../production-subnav";
import { EditModeToggle } from "@/components/forms/edit-mode-toggle";
import { MachineForm } from "../machine-form";
import { PrintMachineLabelButton } from "../print-machine-label-button";

export const metadata = { title: "Machine · Production · PSP" };

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ uuid: string }>;
}

export default async function MachineDetailPage({ params }: Props) {
  const user = await requireUser();
  if (!hasPermission(user, "production.machine_view")) {
    redirect("/settings/profile");
  }

  const { uuid } = await params;
  const [machine, company, initialComments] = await Promise.all([
    getMachine(uuid),
    getCompanyDefaults(),
    listCommentsForEntity("machine", uuid),
  ]);
  if (!machine || !company) notFound();

  const canEdit = hasPermission(user, "production.machine_edit");
  const canDelete = hasPermission(user, "production.machine_delete");
  const canRecalibrate = hasPermission(user, "production.machine_recalibrate");
  const canComment =
    canEdit || hasPermission(user, "production.machine_create");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <PageCursorAnchor
          pageId={`/production/machines/${uuid}`}
          className="mx-auto max-w-5xl space-y-6"
          suppressBanner
        >
          <PageHeader
            size="detail"
            icon={Wrench}
            title={
              <>
                <span>{machine.name}</span>
                {!machine.is_active && <Badge tone="muted">Archived</Badge>}
                {machine.calibration_overdue && (
                  <Badge tone="destructive">Calibration overdue</Badge>
                )}
              </>
            }
            description={
              <span className="font-mono text-xs">
                {machine.asset_tag ?? `#${machine.id}`}
                {machine.workstation && (
                  <>
                    {" "}· Workstation:{" "}
                    <span className="font-medium text-foreground">
                      {machine.workstation.name}
                    </span>
                  </>
                )}
              </span>
            }
            backHref="/production/machines"
            backLabel="Back to machines"
            actions={<PrintMachineLabelButton machine={machine} />}
          />

          <EditModeToggle canEdit={canEdit}>
            <MachineForm
              machine={machine}
              company={company}
              canEdit={canEdit}
              canDelete={canDelete}
              canRecalibrate={canRecalibrate}
            />
          </EditModeToggle>

          <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
            <header className="mb-3">
              <h2 className="text-sm font-semibold tracking-tight">
                Discussion
              </h2>
            </header>
            <CommentThread
              entityType="machine"
              entityUuid={machine.uuid}
              initial={initialComments ?? []}
              canComment={canComment}
              currentUserId={user.id}
            />
          </section>

          <AuditMetaSection
            inserted_at={machine.inserted_at}
            updated_at={machine.updated_at}
            created_by={machine.created_by}
            updated_by={machine.updated_by}
          />
          <AuditHistoryCard
            entityType="machine"
            entityId={machine.id}
            canRestore={false}
          />
        </PageCursorAnchor>
      </main>
    </div>
  );
}
