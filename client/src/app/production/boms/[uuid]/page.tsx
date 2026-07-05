import { notFound, redirect } from "next/navigation";
import { ListChecks } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge-mini";
import { getBOM } from "@/lib/production/server";
import { listCommentsForEntity } from "@/lib/comments/server";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { ProductionSubnav } from "../../production-subnav";
import { BOMDetailShell } from "./bom-detail-shell";

export const metadata = { title: "BOM · Production · PSP" };

interface Props {
  params: Promise<{ uuid: string }>;
}

export const dynamic = "force-dynamic";

export default async function BOMDetailPage({ params }: Props) {
  const user = await requireUser();
  if (!hasPermission(user, "production.bom_view")) {
    redirect("/settings/profile");
  }

  const { uuid } = await params;
  const [bom, initialComments] = await Promise.all([
    getBOM(uuid),
    listCommentsForEntity("bom", uuid),
  ]);
  if (!bom) notFound();

  const canEdit = hasPermission(user, "production.bom_edit");
  const canDelete = hasPermission(user, "production.bom_delete");
  // Comment-write tracks the bom_edit + bom_create perms server-side
  // (`Backend.Comments.@write_perms["bom"]`). Mirror that here so the
  // composer enables / disables in sync with what the API allows.
  const canComment =
    canEdit || hasPermission(user, "production.bom_create");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-5xl space-y-6">
          <PageHeader
            size="detail"
            icon={ListChecks}
            title={
              <>
                <span>{bom.name}</span>
                {bom.is_primary && <Badge tone="emerald">Primary</Badge>}
                {!bom.is_active && <Badge tone="muted">Archived</Badge>}
              </>
            }
            description={
              <span className="font-mono text-xs">
                {bom.code ?? `#${bom.id}`}
                {bom.item && (
                  <>
                    {" "}· Output:{" "}
                    <span className="font-medium text-foreground">
                      {bom.item.name}
                    </span>
                    {bom.item.code && (
                      <span className="ml-1.5">({bom.item.code})</span>
                    )}
                  </>
                )}
              </span>
            }
            backHref="/production/boms"
            backLabel="Back to BOMs"
          />

          <BOMDetailShell
            bom={bom}
            canEdit={canEdit}
            canDelete={canDelete}
            canComment={canComment}
            currentUserId={user.id}
            initialComments={initialComments ?? []}
          />

          <AuditMetaSection
            inserted_at={bom.inserted_at}
            updated_at={bom.updated_at}
            created_by={bom.created_by}
            updated_by={bom.updated_by}
          />
          <AuditHistoryCard entityType="bom" entityId={bom.id} />
        </div>
      </main>
    </div>
  );
}
