import { redirect } from "next/navigation";
import { Receipt } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getCompanyDefaults } from "@/lib/company/server";
import { listInvoicesPage } from "@/lib/invoices/server";
import { ProcurementSubnav } from "../procurement-subnav";
import { InvoicesLedger } from "./invoices-ledger";

export const metadata = { title: "Invoices · Procurement · PSP" };

export default async function ProcurementInvoicesPage() {
  const user = await requireUser();
  if (!hasPermission(user, "procurement.invoice_view")) {
    redirect("/settings/profile");
  }

  const [initialPage, prefs] = await Promise.all([
    listInvoicesPage(),
    getCompanyDefaults(),
  ]);

  const canManage = hasPermission(user, "procurement.invoice_manage");
  const canApprove = hasPermission(user, "procurement.invoice_approve");

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
                <Receipt className="size-7 text-brand sm:size-8" />
                Incoming invoices
              </h1>
              <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                AP ledger of vendor invoices. New invoices are added from
                their parent PO so the ledger always traces back to the
                approved purchase.
              </p>
            </div>
          </header>

          <InvoicesLedger
            initialPage={
              initialPage ?? {
                items: [],
                totals: [],
                next_cursor: null,
              }
            }
            companyCurrency={prefs?.currency_code ?? "GBP"}
            canManage={canManage}
            canApprove={canApprove}
          />
        </div>
      </main>
    </div>
  );
}
