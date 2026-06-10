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
import { StockSubnav } from "../../stock-subnav";
import { LotHeader } from "./lot-header";
import { LotEditForm } from "./lot-edit-form";
import { LotPlacementsCard } from "./lot-placements-card";
import { LotMovementTimeline } from "./lot-movement-timeline";

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
  const [data, prefs] = await Promise.all([
    getStockLot(uuid),
    getCompanyDefaults(),
  ]);
  if (!data) notFound();
  const { lot, movements } = data;
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

          <LotMovementTimeline
            movements={movements}
            uomSymbol={lot.unit_of_measurement?.symbol ?? ""}
            holdingName={holdingName}
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
