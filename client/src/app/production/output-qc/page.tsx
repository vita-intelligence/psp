import { redirect } from "next/navigation";
import { Microscope } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getOutputQcQueue } from "@/lib/production-output-qc/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { listWorkstationGroupsPage } from "@/lib/production/server";
import { ProductionSubnav } from "../production-subnav";
import { OutputQcWorkspace } from "./output-qc-workspace";

export const metadata = { title: "Output QC · Production · PSP" };
export const dynamic = "force-dynamic";

/**
 * Production-side quality sign-off on manufactured output lots.
 * Server-paginated (cursor / limit 50), searchable by item name, and
 * filterable by item type, project type, and workstation group. Each
 * card links to the item's finished-product spec so a QA operator can
 * compare the physical lot against the intended targets.
 */
export default async function OutputQcPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    item_type?: string;
    project_type?: string;
    workstation_group_uuid?: string;
  }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "production.qc_output")) {
    redirect("/production");
  }

  const sp = await searchParams;
  const filters = {
    search: sp.search?.trim() ?? "",
    itemType: sp.item_type?.trim() ?? "",
    projectType: sp.project_type?.trim() ?? "",
    workstationGroupUuid: sp.workstation_group_uuid?.trim() ?? "",
  };

  const [queue, company, wsGroupsPage] = await Promise.all([
    getOutputQcQueue({
      limit: 50,
      search: filters.search || null,
      item_type: filters.itemType || null,
      project_type: filters.projectType || null,
      workstation_group_uuid: filters.workstationGroupUuid || null,
    }),
    getCompanyDefaults(),
    listWorkstationGroupsPage(),
  ]);

  const workstationGroups =
    wsGroupsPage?.items.map((g) => ({ uuid: g.uuid, name: g.name })) ?? [];

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            icon={Microscope}
            title="Output QC"
            description={
              <>
                Pass or fail manufactured output lots before they transfer to
                the warehouse. Search, filter, and open the item&apos;s
                finished-product spec to compare against the physical lot.
              </>
            }
          />

          <OutputQcWorkspace
            initialQueue={queue?.items ?? []}
            initialCursor={queue?.next_cursor ?? null}
            initialFilters={filters}
            workstationGroups={workstationGroups}
            companyDateFormat={company}
          />
        </div>
      </main>
    </div>
  );
}
