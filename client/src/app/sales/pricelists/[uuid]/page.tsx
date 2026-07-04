import { notFound, redirect } from "next/navigation";
import { Tags } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { RecordHero } from "@/components/layout/record-hero";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { PageCursorAnchor } from "@/components/realtime/page-cursor-anchor";
import { Badge } from "@/components/ui/badge-mini";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { CommentThread } from "@/components/comments/comment-thread";
import { listCommentsForEntity } from "@/lib/comments/server";
import { getPricelist } from "@/lib/pricelists/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { EditModeToggle } from "@/components/forms/edit-mode-toggle";
import { SalesSubnav } from "../../sales-subnav";
import { PricelistForm } from "../pricelist-form";
import { PricelistLinesCard } from "../pricelist-lines-card";

export const metadata = { title: "Pricelist · Sales · PSP" };

export default async function PricelistDetailPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "pricelists.view")) {
    redirect("/settings/profile");
  }

  const { uuid } = await params;
  const [pricelist, company, initialComments] = await Promise.all([
    getPricelist(uuid),
    getCompanyDefaults(),
    listCommentsForEntity("pricelist", uuid),
  ]);
  if (!pricelist || !company) notFound();

  const canEdit = hasPermission(user, "pricelists.edit");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <SalesSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <PageCursorAnchor
          pageId={`/sales/pricelists/${uuid}`}
          className="mx-auto max-w-5xl space-y-6"
        >
          <RecordHero
            icon={Tags}
            code={pricelist.code ?? `#${pricelist.id}`}
            chips={
              <>
                <Badge tone={pricelist.is_active ? "emerald" : "muted"}>
                  {pricelist.is_active ? "Active" : "Inactive"}
                </Badge>
                {pricelist.is_default && <Badge tone="amber">Default</Badge>}
              </>
            }
            title={pricelist.name}
            subtitle={
              <p className="text-xs text-muted-foreground">
                Currency:{" "}
                <span className="font-medium text-foreground">
                  {pricelist.currency_code}
                </span>{" "}
                · {pricelist.items.length} item
                {pricelist.items.length === 1 ? "" : "s"}
              </p>
            }
            backHref="/sales/pricelists"
            backLabel="Back to pricelists"
          />

          <EditModeToggle canEdit={canEdit}>
            <PricelistForm
              pricelist={pricelist}
              company={company}
              canEdit={canEdit}
            />
          </EditModeToggle>

          <PricelistLinesCard
            pricelist={pricelist}
            canEdit={canEdit}
            prefs={company}
            pageId={`/sales/pricelists/${uuid}`}
          />

          <CommentThread
            entityType="pricelist"
            entityUuid={pricelist.uuid}
            initial={initialComments ?? []}
            canComment={canEdit}
            currentUserId={user.id}
          />

          <AuditMetaSection
            inserted_at={pricelist.inserted_at}
            updated_at={pricelist.updated_at}
            created_by={pricelist.created_by ?? null}
            updated_by={pricelist.updated_by ?? null}
          />
          <AuditHistoryCard entityType="pricelist" entityId={pricelist.id} />
        </PageCursorAnchor>
      </main>
    </div>
  );
}
