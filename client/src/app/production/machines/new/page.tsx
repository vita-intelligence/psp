import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Wrench } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { getCompanyDefaults } from "@/lib/company/server";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { ProductionSubnav } from "../../production-subnav";
import { MachineForm } from "../machine-form";

export const metadata = { title: "New machine · Production · PSP" };

interface Props {
  searchParams: Promise<{ workstation_id?: string }>;
}

export default async function NewMachinePage({ searchParams }: Props) {
  const user = await requireUser();
  if (!hasPermission(user, "production.machine_create")) {
    redirect("/settings/profile");
  }
  const company = await getCompanyDefaults();
  if (!company) notFound();

  // Deep-link support: /production/machines/new?workstation_id=42
  // lets the workstation detail page hand off to the machine form
  // with the parent already selected.
  const params = await searchParams;
  const defaultWorkstationId = params.workstation_id
    ? Number.parseInt(params.workstation_id, 10)
    : null;

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
              <Link href="/production/machines">
                <ChevronLeft className="mr-1 size-4" />
                Back to machines
              </Link>
            </Button>
          </div>

          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              <Wrench className="size-6 text-brand" />
              New machine
            </h1>
          </header>

          <MachineForm
            machine={null}
            company={company}
            canEdit
            canDelete={false}
            canRecalibrate={false}
            defaultWorkstationId={
              Number.isFinite(defaultWorkstationId as number)
                ? (defaultWorkstationId as number)
                : null
            }
          />
        </div>
      </main>
    </div>
  );
}
