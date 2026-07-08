import { notFound, redirect } from "next/navigation";
import { Factory } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { PageHeader } from "@/components/layout/page-header";
import { getManufacturingOrder, listMOSessions } from "@/lib/production/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { ProductionSubnav } from "../../production-subnav";
import { MOParentBreadcrumb } from "../../manufacturing-orders/mo-sub-production";
import { ProductionRunDetail } from "./production-run-detail";
import { MOSessionsCard } from "@/components/production/mo-sessions-card";

export const metadata = { title: "Production run · Production · PSP" };

export const dynamic = "force-dynamic";

interface Params {
  mo_uuid: string;
}

export default async function ProductionRunDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "production.mo_execute")) {
    redirect("/production");
  }

  const { mo_uuid } = await params;
  const [mo, company] = await Promise.all([
    getManufacturingOrder(mo_uuid),
    getCompanyDefaults(),
  ]);

  if (!mo || !company) notFound();

  const initialSessions = await listMOSessions(mo.id);

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-6xl space-y-6">
          <PageHeader
            size="detail"
            icon={Factory}
            title={mo.item ? mo.item.name : "Manufacturing order"}
            description={
              <span className="font-mono text-xs">
                {mo.code ?? `#${mo.id}`}
                {mo.warehouse && (
                  <>
                    {" "}· Site:{" "}
                    <span className="font-medium text-foreground">
                      {mo.warehouse.name}
                    </span>
                  </>
                )}
                {mo.bom && (
                  <>
                    {" "}· BOM:{" "}
                    <span className="font-medium text-foreground">
                      {mo.bom.code ?? mo.bom.name}
                    </span>
                  </>
                )}
              </span>
            }
            backHref="/production/runs"
            backLabel="Back to production runs"
          />

          <MOParentBreadcrumb mo={mo} />

          {/* Sessions timeline sits prominently under the run header
              so an operator monitoring the floor sees who's clocked
              in + live timers without scrolling past the run
              controls. Realtime channel refreshes in <250ms. */}
          <MOSessionsCard
            moUuid={mo.uuid}
            initialSessions={initialSessions}
            prefs={company}
          />

          <ProductionRunDetail initialMo={mo} company={company} />
        </div>
      </main>
    </div>
  );
}
