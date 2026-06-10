import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ShoppingCart } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { listVendorsForPicker } from "@/lib/vendors/server";
import { ProcurementSubnav } from "../../procurement-subnav";
import { NewPOForm } from "./new-po-form";

export const metadata = { title: "New PO · Procurement · PSP" };

export default async function NewPOPage() {
  const user = await requireUser();
  if (!hasPermission(user, "procurement.po_create")) {
    redirect("/procurement/purchase-orders");
  }

  const vendors = (await listVendorsForPicker()) ?? [];

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProcurementSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-4xl space-y-6">
          <div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
            >
              <Link href="/procurement/purchase-orders">
                <ChevronLeft className="mr-1 size-4" />
                Back to POs
              </Link>
            </Button>
          </div>

          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              <ShoppingCart className="size-6 text-brand sm:size-7" />
              New purchase order
            </h1>
            <p className="text-sm text-muted-foreground">
              Pick an approved vendor. The PO lands as draft — you can
              add line items + submit from the detail page.
            </p>
          </header>

          <NewPOForm vendors={vendors} />
        </div>
      </main>
    </div>
  );
}
