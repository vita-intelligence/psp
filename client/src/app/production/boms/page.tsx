import { redirect } from "next/navigation";
import Link from "next/link";
import { ListChecks, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { listBOMsPage } from "@/lib/production/server";
import { ProductionSubnav } from "../production-subnav";
import { BOMsLedger } from "./boms-ledger";

export const metadata = { title: "BOMs · Production · PSP" };

export default async function ProductionBOMsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "production.bom_view")) {
    redirect("/settings/profile");
  }

  const initialPage = await listBOMsPage();
  const canCreate = hasPermission(user, "production.bom_create");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            icon={ListChecks}
            title="Bills of Materials"
            description={
              <>
                Recipes for every manufactured item. The{" "}
                <strong>primary</strong> flag marks the default
                version manufacturing orders consume; siblings stay
                selectable for variants.
              </>
            }
            actions={
              canCreate && (
                <Button asChild size="sm">
                  <Link href="/production/boms/new">
                    <Plus className="mr-1.5 size-4" />
                    Create BOM
                  </Link>
                </Button>
              )
            }
          />

          <BOMsLedger
            initialPage={
              initialPage ?? {
                items: [],
                next_cursor: null,
              }
            }
          />
        </div>
      </main>
    </div>
  );
}
