import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Package } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
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
  if (!hasPermission(user, "production.final_release")) {
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
          <div className="flex items-center gap-2 text-sm">
            <Link
              href="/three-pl"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-4" />
              3PL storage
            </Link>
          </div>

          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              <Package className="size-6 text-brand sm:size-7" />
              {detail.lot.item?.name ?? "3PL lot"}
            </h1>
            <p className="text-sm text-muted-foreground">
              Lot{" "}
              <span className="font-mono">{detail.lot.code ?? "—"}</span> —
              held under bailee custody for{" "}
              <span className="font-semibold text-foreground">
                {detail.lot.bailee_customer?.name ?? "customer"}
              </span>
              .
            </p>
          </header>

          <LotDetailShell detail={detail} companyDefaults={defaults} />
        </div>
      </main>
    </div>
  );
}
