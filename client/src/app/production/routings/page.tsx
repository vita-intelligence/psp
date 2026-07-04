import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, Route } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { listRoutingsPage } from "@/lib/production/server";
import { ProductionSubnav } from "../production-subnav";
import { RoutingsLedger } from "./routings-ledger";

export const metadata = { title: "Routings · Production · PSP" };

export default async function ProductionRoutingsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "production.routing_view")) {
    redirect("/settings/profile");
  }

  const initialPage = await listRoutingsPage();
  const canCreate = hasPermission(user, "production.routing_create");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            icon={Route}
            title="Routings"
            description="Ordered operations against workstation groups that turn a BOM into a finished item. Drives MO planning + costing."
            actions={
              canCreate && (
                <Button asChild size="sm">
                  <Link href="/production/routings/new">
                    <Plus className="mr-1.5 size-4" />
                    Create routing
                  </Link>
                </Button>
              )
            }
          />

          <RoutingsLedger
            initialPage={initialPage ?? { items: [], next_cursor: null }}
          />
        </div>
      </main>
    </div>
  );
}
