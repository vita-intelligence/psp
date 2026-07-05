import Link from "next/link";
import { redirect } from "next/navigation";
import { PackageCheck, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { ActiveSessionsBanner } from "@/components/realtime/active-sessions";
import { listCustomerReturnsPage } from "@/lib/customer-returns/server";
import { SalesSubnav } from "../sales-subnav";
import { ReturnsTable } from "./returns-table";

export const metadata = { title: "Returns (RMAs) · Sales · PSP" };

export default async function ReturnsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "customer_returns.view")) {
    redirect("/settings/profile");
  }

  const initialPage = (await listCustomerReturnsPage()) ?? {
    items: [],
    next_cursor: null,
  };

  const canCreate = hasPermission(user, "customer_returns.create");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <SalesSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            icon={PackageCheck}
            title="Returns (RMAs)"
            description="Customer returns. Quality inspects each line, then either accepts (auto-issues a credit note against the source invoice) or rejects with reason. Cancellations need a reason too."
            actions={
              canCreate && (
                <Button asChild size="sm" className="shrink-0">
                  <Link href="/sales/returns/new">
                    <Plus className="mr-1.5 size-4" />
                    New RMA
                  </Link>
                </Button>
              )
            }
          />

          <ActiveSessionsBanner
            currentUserId={user.id}
            resourcePrefix="customer-return"
            newRoute="/sales/returns/new"
            resourceLabel="RMA"
            canCreate={canCreate}
          />

          <ReturnsTable initialPage={initialPage} />
        </div>
      </main>
    </div>
  );
}
