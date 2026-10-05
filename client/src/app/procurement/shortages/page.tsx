import { redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import {
  getProcurementShortages,
  getShortageProjects,
} from "@/lib/procurement-shortages/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { ProcurementSubnav } from "../procurement-subnav";
import { ShortagesWorkspace } from "./shortages-workspace";

export const metadata = { title: "Shortages · Procurement · PSP" };
export const dynamic = "force-dynamic";

export default async function ProcurementShortagesPage() {
  const user = await requireUser();
  if (!hasPermission(user, "procurement.po_create")) {
    redirect("/settings/profile");
  }

  const [data, projects, company] = await Promise.all([
    getProcurementShortages(),
    getShortageProjects(),
    getCompanyDefaults(),
  ]);

  const initialPage = {
    items: data?.items ?? [],
    next_cursor: data?.next_cursor ?? null,
  };

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProcurementSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto w-full space-y-6">
          <PageHeader
            icon={FileText}
            title="Shortages"
            description="Every raw-material and packaging item still short across open manufacturing orders, after subtracting existing bookings and qty already on open POs. Toggle between the flat list, a vendor-grouped view (one PO per cluster), or a project-scoped view to raise purchases for a single product."
          />

          <ShortagesWorkspace
            initialPage={initialPage}
            projects={projects?.projects ?? []}
            companyDateFormat={company}
          />
        </div>
      </main>
    </div>
  );
}
