import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, Users } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getCompanyDefaults } from "@/lib/company/server";
import { listUsersFirstPage } from "@/lib/users/server";
import { listPricelistsForPicker } from "@/lib/pricelists/server";
import { listLoyaltyPrograms } from "@/lib/loyalty/server";
import { SalesSubnav } from "../../sales-subnav";
import { CustomerForm } from "../customer-form";

export const metadata = { title: "New customer · Sales · PSP" };

export default async function NewCustomerPage() {
  const user = await requireUser();
  if (!hasPermission(user, "customers.create")) {
    redirect("/sales/customers");
  }

  const [company, userListPage, pricelists, loyaltyPrograms] =
    await Promise.all([
      getCompanyDefaults(),
      listUsersFirstPage(100),
      listPricelistsForPicker(),
      listLoyaltyPrograms(),
    ]);

  if (!company) {
    // No defaults ⇒ something is very wrong with the company endpoint;
    // bounce back to the safe list page rather than render a broken
    // form. (CompanyDefaults seeds currency / locale / dates.)
    redirect("/sales/customers");
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
              <Link href="/sales/customers">
                <ChevronLeft className="mr-1 size-4" />
                Back to customers
              </Link>
            </Button>
          </div>

          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              <Users className="size-6 text-brand sm:size-7" />
              New customer
            </h1>
            <p className="text-sm text-muted-foreground">
              Lands as <strong>draft</strong> — approval (4-eyes) is a
              separate gate downstream and unlocks Customer Order
              creation against this account.
            </p>
          </header>

          <CustomerForm
            customer={null}
            company={company}
            users={userListPage.items}
            pricelists={pricelists ?? []}
            availablePrograms={
              (loyaltyPrograms ?? []).filter((p) => p.is_active)
            }
            canEdit={true}
          />
        </div>
      </main>
    </div>
  );
}
