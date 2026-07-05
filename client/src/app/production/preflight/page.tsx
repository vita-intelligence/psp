import { redirect } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getPreflightQueue } from "@/lib/production-preflight/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { ProductionSubnav } from "../production-subnav";
import { PreflightWorkspace } from "./preflight-workspace";

export const metadata = {
  title: "Pre-production · Production · PSP",
};

/**
 * Production-operator desktop landing for the post-pickup receipt
 * sign-off. Lists every MO whose warehouse pickup has completed but
 * still has at least one raw-material / packaging booking awaiting
 * the per-booking qty + quality confirmation. Same data the mobile
 * `/m/preflight` page consumes, laid out for a desk operator
 * supervising multiple lines at once.
 */
export default async function ProductionPreflightPage() {
  const user = await requireUser();
  if (!hasPermission(user, "production.preflight")) {
    redirect("/production");
  }

  const [queue, company] = await Promise.all([
    getPreflightQueue(),
    getCompanyDefaults(),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            icon={ClipboardCheck}
            title="Pre-production"
            description="Sign off on raw materials + packaging after the warehouse picker drops them at the production-feed cell. Each MO needs every booked line verified (qty + quality) before production can start."
          />

          <PreflightWorkspace
            initialQueue={queue?.items ?? []}
            companyDateFormat={company}
          />
        </div>
      </main>
    </div>
  );
}
