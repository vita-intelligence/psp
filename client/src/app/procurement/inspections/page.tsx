import { redirect } from "next/navigation";
import { Microscope } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { listInspectionsPage } from "@/lib/inspections/server";
import { ProcurementSubnav } from "../procurement-subnav";
import { InspectionsLedger } from "./inspections-ledger";

export const metadata = { title: "Inspections · Procurement · PSP" };

export default async function ProcurementInspectionsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "goods_in.view")) {
    redirect("/settings/profile");
  }

  const initialPage = await listInspectionsPage();

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProcurementSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                <Microscope className="size-7 text-brand sm:size-8" />
                Goods-in inspections
              </h1>
              <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                BRCGS / FSSC 22000 incoming-goods inspection ledger.
                Every approved delivery clears QC through here before
                its lots leave quarantine.
              </p>
            </div>
          </header>

          <InspectionsLedger
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
