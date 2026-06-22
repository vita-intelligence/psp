import { redirect } from "next/navigation";
import { Microscope } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getOutputQcQueue } from "@/lib/production-output-qc/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { ProductionSubnav } from "../production-subnav";
import { OutputQcWorkspace } from "./output-qc-workspace";

export const metadata = { title: "Output QC · Production · PSP" };

/**
 * Production-side quality sign-off on manufactured output lots.
 * Lists every lot still in `received` status (the state every Finish
 * call inserts in); operator passes or fails each one to flip it to
 * `available` or `qc_failed`. Gated by `production.qc_output` — a
 * separate capability from `stock.qc` so a finished-goods QC role
 * doesn't bleed into incoming-PO inspections.
 */
export default async function OutputQcPage() {
  const user = await requireUser();
  if (!hasPermission(user, "production.qc_output")) {
    redirect("/production");
  }

  const [queue, company] = await Promise.all([
    getOutputQcQueue(),
    getCompanyDefaults(),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              <Microscope className="size-7 text-brand sm:size-8" />
              Output QC
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
              Pass or fail manufactured output lots before they
              transfer to the warehouse. The lot stays{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
                received
              </code>{" "}
              until you sign off — passing flips it to{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
                available
              </code>
              , failing flips it to{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
                qc_failed
              </code>{" "}
              for investigation.
            </p>
          </header>

          <OutputQcWorkspace
            initialQueue={queue?.items ?? []}
            companyDateFormat={company}
          />
        </div>
      </main>
    </div>
  );
}
