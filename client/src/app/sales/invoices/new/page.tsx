import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, Receipt } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getCompanyDefaults } from "@/lib/company/server";
import { listCustomersForPicker } from "@/lib/customers/server";
import { SalesSubnav } from "../../sales-subnav";
import { NewInvoiceForm } from "./new-invoice-form";

export const metadata = { title: "New invoice · Sales · PSP" };

export default async function NewInvoicePage() {
  const user = await requireUser();
  if (!hasPermission(user, "customer_invoices.create")) {
    redirect("/sales/invoices");
  }

  const [company, customers] = await Promise.all([
    getCompanyDefaults(),
    listCustomersForPicker(),
  ]);

  if (!company) redirect("/sales/invoices");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <SalesSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-3xl space-y-6">
          <div>
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <Link href="/sales/invoices">
                <ChevronLeft className="mr-1 size-4" />
                Back to invoices
              </Link>
            </Button>
          </div>

          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              <Receipt className="size-6 text-brand sm:size-7" />
              New invoice
            </h1>
            <p className="text-sm text-muted-foreground">
              Pick a customer and (optionally) a confirmed CO to auto-pull
              unbilled lines. Or create a blank invoice for a one-off
              service charge.
            </p>
          </header>

          <NewInvoiceForm company={company} customers={customers ?? []} />
        </div>
      </main>
    </div>
  );
}
