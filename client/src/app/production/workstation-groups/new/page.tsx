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
import { WorkstationGroupForm } from "../workstation-group-form";

export const metadata = {
  title: "New workstation group · Production · PSP",
};

export default async function NewWorkstationGroupPage() {
  const user = await requireUser();
  if (!hasPermission(user, "production.workstation_group_create")) {
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
        <div className="mx-auto max-w-3xl space-y-6">
          <div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
            >
              <Link href="/production/workstation-groups">
                <ChevronLeft className="mr-1 size-4" />
                Back to workstation groups
              </Link>
            </Button>
          </div>

          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              <Factory className="size-6 text-brand" />
              New workstation group
            </h1>
          </header>

          <WorkstationGroupForm
            group={null}
            company={company}
            canEdit
            canDelete={false}
          />
        </div>
      </main>
    </div>
  );
}
