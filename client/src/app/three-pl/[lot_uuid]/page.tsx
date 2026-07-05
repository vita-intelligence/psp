import { notFound, redirect } from "next/navigation";
import { Package } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { PageHeader } from "@/components/layout/page-header";
import { getCompanyDefaults } from "@/lib/company/server";
import { getThreePLLotDetail } from "@/lib/three-pl/server";
import { LotDetailShell } from "./lot-detail-shell";

export const metadata = { title: "3PL lot · PSP" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ lot_uuid: string }>;
}

export default async function ThreePLLotDetailPage({ params }: Props) {
  const user = await requireUser();
  if (!hasPermission(user, "three_pl.view")) {
    redirect("/settings/profile");
  }

  const { lot_uuid: lotUuid } = await params;
  const [detail, defaults] = await Promise.all([
    getThreePLLotDetail(lotUuid),
    getCompanyDefaults(),
  ]);

  if (!detail) notFound();

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-5xl space-y-6">
          <PageHeader
            size="detail"
            icon={Package}
            title={detail.lot.item?.name ?? "3PL lot"}
            description={
              <>
                Lot{" "}
                <span className="font-mono">{detail.lot.code ?? "—"}</span> —
                held under bailee custody for{" "}
                <span className="font-semibold text-foreground">
                  {detail.lot.bailee_customer?.name ?? "customer"}
                </span>
                .
              </>
            }
            backHref="/three-pl"
            backLabel="3PL storage"
          />

          <LotDetailShell detail={detail} companyDefaults={defaults} />
        </div>
      </main>
    </div>
  );
}
