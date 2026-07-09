import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, Wrench } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { listMachinesPage } from "@/lib/production/server";
import { ProductionSubnav } from "../production-subnav";
import { MachinesLedger } from "./machines-ledger";

export const metadata = { title: "Machines · Production · PSP" };

export default async function MachinesPage() {
  const user = await requireUser();
  if (!hasPermission(user, "production.machine_view")) {
    redirect("/settings/profile");
  }

  const initialPage = await listMachinesPage();
  const canCreate = hasPermission(user, "production.machine_create");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            icon={Wrench}
            title="Machines"
            description="Physical assets attached to a workstation. Each carries its own per-hour cost (energy, depreciation, upkeep) that sums into the workstation rate, plus calibration schedule + traceability metadata for audit."
            actions={
              canCreate && (
                <Button asChild size="sm">
                  <Link href="/production/machines/new">
                    <Plus className="mr-1.5 size-4" />
                    Create machine
                  </Link>
                </Button>
              )
            }
          />

          <MachinesLedger
            initialPage={initialPage ?? { items: [], next_cursor: null }}
          />
        </div>
      </main>
    </div>
  );
}
