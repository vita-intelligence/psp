import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getFinalReleaseQueue } from "@/lib/production-final-release/server";
import { ProductionSubnav } from "../production-subnav";
import { FinalReleaseWorklist } from "./final-release-worklist";

export const metadata = { title: "Final release · Production · PSP" };
export const dynamic = "force-dynamic";

export default async function FinalReleaseQueuePage() {
  const user = await requireUser();
  if (!hasPermission(user, "production.final_release")) {
    redirect("/settings/profile");
  }

  const queue = await getFinalReleaseQueue();
  const initialPage = {
    items: queue?.items ?? [],
    next_cursor: queue?.next_cursor ?? null,
  };

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              <ShieldCheck className="size-7 text-brand sm:size-8" />
              Final Product Release
            </h1>
            <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
              Finished batches awaiting QA sign-off before dispatch (BRCGS
              Issue 9 § 5.6 Positive Release). Two different signatures + CoA
              + BMR + micro / potency report + label proof are required
              before Release fires; Hold and Reject need one signature and a
              recorded reason.
            </p>
          </header>

          <FinalReleaseWorklist initialPage={initialPage} />
        </div>
      </main>
    </div>
  );
}
