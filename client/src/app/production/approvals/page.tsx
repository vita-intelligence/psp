import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { listManufacturingOrdersPage } from "@/lib/production/server";
import { ProductionSubnav } from "../production-subnav";
import { ApprovalsWorklist } from "./approvals-worklist";

export const metadata = {
  title: "Approvals · Production · PSP",
};

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "production.mo_view")) {
    redirect("/settings/profile");
  }

  // Only `prepared` MOs are awaiting countersignature. The page is
  // useful even without mo_approve (planners can see what's in the
  // queue) — actions on each row are gated separately.
  const initialPage = await listManufacturingOrdersPage({
    query: "status=prepared",
  });

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            icon={ShieldCheck}
            title="Approvals"
            description="Manufacturing orders awaiting the 2nd signature. Each row shows the preparer, age in the queue, and lets you jump straight in to review."
          />

          <ApprovalsWorklist
            initialPage={initialPage ?? { items: [], next_cursor: null }}
          />
        </div>
      </main>
    </div>
  );
}
