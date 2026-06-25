import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, PackageCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { listCustomersForPicker } from "@/lib/customers/server";
import { SalesSubnav } from "../../sales-subnav";
import { NewReturnForm } from "./new-return-form";

export const metadata = { title: "New RMA · Sales · PSP" };

export default async function NewReturnPage() {
  const user = await requireUser();
  if (!hasPermission(user, "customer_returns.create")) {
    redirect("/sales/returns");
  }

  const customers = await listCustomersForPicker();

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <SalesSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-3xl space-y-6">
          <div>
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <Link href="/sales/returns">
                <ChevronLeft className="mr-1 size-4" />
                Back to RMAs
              </Link>
            </Button>
          </div>

          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              <PackageCheck className="size-6 text-brand sm:size-7" />
              New RMA
            </h1>
            <p className="text-sm text-muted-foreground">
              Pick a customer and (optionally) the source invoice. Lines are
              added on the next screen and inspected before accept/reject —
              accepting auto-issues a credit note against the invoice.
            </p>
          </header>

          <NewReturnForm customers={customers ?? []} />
        </div>
      </main>
    </div>
  );
}
