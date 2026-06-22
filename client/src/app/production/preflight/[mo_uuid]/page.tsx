import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ClipboardCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getPreflightDetail } from "@/lib/production-preflight/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { ProductionSubnav } from "../../production-subnav";
import { PreflightMoDetail } from "./preflight-mo-detail";

export const metadata = {
  title: "Pre-production check · Production · PSP",
};

interface Params {
  mo_uuid: string;
}

export default async function PreflightMoPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "production.preflight")) {
    redirect("/production");
  }

  const { mo_uuid } = await params;
  const [detail, company] = await Promise.all([
    getPreflightDetail(mo_uuid),
    getCompanyDefaults(),
  ]);

  if (!detail) notFound();

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-5xl space-y-6">
          <header className="space-y-3">
            <Button asChild variant="ghost" size="sm" className="-ml-2">
              <Link href="/production/preflight">
                <ArrowLeft className="mr-1.5 size-3.5" />
                All MOs awaiting sign-off
              </Link>
            </Button>
            <div>
              <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                <ClipboardCheck className="size-7 text-brand sm:size-8" />
                {detail.mo.code ?? `MO #${detail.mo.id}`}
              </h1>
              <p className="text-sm text-muted-foreground sm:text-base">
                {detail.mo.item?.name ?? "Unknown item"} ·{" "}
                {detail.mo.quantity} units
              </p>
            </div>
          </header>

          <PreflightMoDetail
            initialMo={detail.mo}
            initialBookings={detail.bookings}
            initialPreflightComplete={detail.preflight_complete}
            companyDateFormat={company}
          />
        </div>
      </main>
    </div>
  );
}
