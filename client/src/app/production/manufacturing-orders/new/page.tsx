import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Factory } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { getCompanyDefaults } from "@/lib/company/server";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { ProductionSubnav } from "../../production-subnav";
import { ManufacturingOrderForm } from "../mo-form";

export const metadata = { title: "New manufacturing order · Production · PSP" };

export default async function NewManufacturingOrderPage() {
  const user = await requireUser();
  if (!hasPermission(user, "production.mo_create")) {
    redirect("/settings/profile");
  }
  const company = await getCompanyDefaults();
  if (!company) notFound();

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-5xl space-y-6">
          <div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
            >
              <Link href="/production/manufacturing-orders">
                <ChevronLeft className="mr-1 size-4" />
                Back to manufacturing orders
              </Link>
            </Button>
          </div>

          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              <Factory className="size-6 text-brand" />
              New manufacturing order
            </h1>
          </header>

          <ManufacturingOrderForm
            mo={null}
            company={company}
            canEdit
            canDelete={false}
          />
        </div>
      </main>
    </div>
  );
}
