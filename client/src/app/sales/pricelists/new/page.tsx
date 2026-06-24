import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, Tags } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getCompanyDefaults } from "@/lib/company/server";
import { SalesSubnav } from "../../sales-subnav";
import { PricelistForm } from "../pricelist-form";

export const metadata = { title: "New pricelist · Sales · PSP" };

export default async function NewPricelistPage() {
  const user = await requireUser();
  if (!hasPermission(user, "pricelists.create")) {
    redirect("/sales/pricelists");
  }

  const company = await getCompanyDefaults();
  if (!company) {
    redirect("/sales/pricelists");
  }

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <SalesSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-5xl space-y-6">
          <div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
            >
              <Link href="/sales/pricelists">
                <ChevronLeft className="mr-1 size-4" />
                Back to pricelists
              </Link>
            </Button>
          </div>

          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              <Tags className="size-6 text-brand sm:size-7" />
              New pricelist
            </h1>
            <p className="text-sm text-muted-foreground">
              Create the header first. Line items can be added once the
              pricelist exists.
            </p>
          </header>

          <PricelistForm
            pricelist={null}
            company={company}
            canEdit={true}
          />
        </div>
      </main>
    </div>
  );
}
