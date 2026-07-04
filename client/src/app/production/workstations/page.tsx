import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, Settings2 } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { listWorkstationsPage } from "@/lib/production/server";
import { ProductionSubnav } from "../production-subnav";
import { WorkstationsLedger } from "./workstations-ledger";

export const metadata = { title: "Workstations · Production · PSP" };

export default async function WorkstationsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "production.workstation_view")) {
    redirect("/settings/profile");
  }

  const initialPage = await listWorkstationsPage();
  const canCreate = hasPermission(user, "production.workstation_create");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            icon={Settings2}
            title="Workstations"
            description="Individual machines + line slots inside a workstation group. Schedule, MOs, and vita-performance scoring run against these rows."
            actions={
              canCreate && (
                <Button asChild size="sm">
                  <Link href="/production/workstations/new">
                    <Plus className="mr-1.5 size-4" />
                    Create workstation
                  </Link>
                </Button>
              )
            }
          />

          <WorkstationsLedger
            initialPage={initialPage ?? { items: [], next_cursor: null }}
          />
        </div>
      </main>
    </div>
  );
}
