import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, Gift } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { SalesSubnav } from "../../../sales-subnav";
import { NewLoyaltyProgramForm } from "./new-loyalty-program-form";

export const metadata = { title: "New loyalty program · Sales · PSP" };

export default async function NewLoyaltyProgramPage() {
  const user = await requireUser();
  if (!hasPermission(user, "loyalty.programs_manage")) {
    redirect("/sales/loyalty");
  }

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <SalesSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-3xl space-y-6">
          <div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
            >
              <Link href="/sales/loyalty">
                <ChevronLeft className="mr-1 size-4" />
                Back to loyalty
              </Link>
            </Button>
          </div>

          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              <Gift className="size-6 text-brand sm:size-7" />
              New loyalty program
            </h1>
            <p className="text-sm text-muted-foreground">
              Name the program first. Tiers and lifecycle settings show up
              on the next screen once it&rsquo;s saved.
            </p>
          </header>

          <NewLoyaltyProgramForm />
        </div>
      </main>
    </div>
  );
}
