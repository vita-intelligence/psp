import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Layers } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getStockLot } from "@/lib/stock/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { CommentThread } from "@/components/comments/comment-thread";
import { listCommentsForEntity } from "@/lib/comments/server";
import { StockSubnav } from "../../stock-subnav";
import { LotHeader } from "./lot-header";
import { LotEditForm } from "./lot-edit-form";
import { LotPlacementsCard } from "./lot-placements-card";
import { LotMovementTimeline } from "./lot-movement-timeline";
import { LotInspectionCard } from "./lot-inspection-card";
import { LotMoBookingsCard } from "./lot-mo-bookings-card";
import {
  LotFilesCard,
  LotReturnPicksCard,
} from "./lot-extras-card";

export const metadata = { title: "Lot detail · Stock · PSP" };

export default async function StockLotDetailPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "stock.view")) {
    redirect("/settings/profile");
  }

  const { uuid } = await params;
  const [data, prefs, initialComments] = await Promise.all([
    getStockLot(uuid),
    getCompanyDefaults(),
    listCommentsForEntity("stock_lot", uuid),
  ]);
  if (!data) notFound();
  const { lot, movements } = data;
  const canCommentOnLot =
    hasPermission(user, "stock.edit") || hasPermission(user, "stock.receive");
  const holdingName = prefs?.generic_place_name?.trim() || "Holding Room";

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <StockSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-5xl space-y-6">
          <div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
            >
              <Link href="/stock/lots">
                <ChevronLeft className="mr-1 size-4" />
                Back to lots
              </Link>
            </Button>
          </div>

          <LotHeader
            lot={lot}
            canMove={hasPermission(user, "stock.move")}
            canAdjust={hasPermission(user, "stock.adjust")}
          />

          <LotEditForm
            lot={lot}
            canEdit={hasPermission(user, "stock.edit")}
          />

          <LotPlacementsCard lot={lot} />

          {lot.goods_in_inspection && prefs && (
            <LotInspectionCard
              inspection={lot.goods_in_inspection}
              prefs={prefs}
            />
          )}

          {lot.mo_bookings && lot.mo_bookings.length > 0 && prefs && (
            <LotMoBookingsCard
              bookings={lot.mo_bookings}
              uomSymbol={lot.unit_of_measurement?.symbol ?? ""}
              prefs={prefs}
            />
          )}

          {lot.return_picks && lot.return_picks.length > 0 && prefs && (
            <LotReturnPicksCard
              picks={lot.return_picks}
              uomSymbol={lot.unit_of_measurement?.symbol ?? ""}
              holdingName={holdingName}
              prefs={prefs}
            />
          )}

          {lot.files && lot.files.length > 0 && prefs && (
            <LotFilesCard files={lot.files} prefs={prefs} />
          )}

          <LotMovementTimeline
            movements={movements}
            uomSymbol={lot.unit_of_measurement?.symbol ?? ""}
            holdingName={holdingName}
          />

          <CommentThread
            entityType="stock_lot"
            entityUuid={lot.uuid}
            initial={initialComments ?? []}
            canComment={canCommentOnLot}
            currentUserId={user.id}
          />

          <AuditMetaSection
            inserted_at={lot.inserted_at}
            updated_at={lot.updated_at}
            created_by={lot.created_by ?? null}
            updated_by={lot.updated_by ?? null}
          />
          <AuditHistoryCard entityType="stock_lot" entityId={lot.id} />
        </div>
      </main>
    </div>
  );
}
