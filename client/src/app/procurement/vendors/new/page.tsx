import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, Users } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { ProcurementSubnav } from "../../procurement-subnav";
import { VendorForm } from "../vendor-form";

export const metadata = { title: "New vendor · Procurement · PSP" };

export default async function NewVendorPage() {
  const user = await requireUser();
  if (!hasPermission(user, "vendors.create")) {
    redirect("/procurement/vendors");
  }

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
              <Link href="/procurement/vendors">
                <ChevronLeft className="mr-1 size-4" />
                Back to vendors
              </Link>
            </Button>
          </div>

          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              <Users className="size-6 text-brand sm:size-7" />
              New vendor
            </h1>
            <p className="text-sm text-muted-foreground">
              Lands as <strong>pending</strong> — approval is a separate
              gate downstream.
            </p>
          </header>

          <VendorForm vendor={null} canEdit={true} />
        </div>
      </main>
    </div>
  );
}
