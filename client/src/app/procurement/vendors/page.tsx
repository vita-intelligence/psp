import Link from "next/link";
import { redirect } from "next/navigation";
import { Users, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { ActiveSessionsBanner } from "@/components/realtime/active-sessions";
import { listVendorsPage } from "@/lib/vendors/server";
import { ProcurementSubnav } from "../procurement-subnav";
import { VendorsTable } from "./vendors-table";

export const metadata = { title: "Vendors · Procurement · PSP" };

export default async function VendorsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "vendors.view")) {
    redirect("/settings/profile");
  }

  const initialPage = (await listVendorsPage()) ?? {
    items: [],
    next_cursor: null,
  };

  const canCreate = hasPermission(user, "vendors.create");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProcurementSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            icon={Users}
            title="Vendors"
            description="Approved-supplier registry. Risk class + qualification status + per-item approval list drive what each vendor can sell us on a PO."
            actions={
              canCreate && (
                <Button asChild size="sm" className="shrink-0">
                  <Link href="/procurement/vendors/new">
                    <Plus className="mr-1.5 size-4" />
                    New vendor
                  </Link>
                </Button>
              )
            }
          />

          <ActiveSessionsBanner
            currentUserId={user.id}
            resourcePrefix="vendor"
            newRoute="/procurement/vendors/new"
            resourceLabel="vendor"
            canCreate={canCreate}
          />

          <VendorsTable
            initialPage={initialPage}
            canCreate={canCreate}
          />
        </div>
      </main>
    </div>
  );
}
