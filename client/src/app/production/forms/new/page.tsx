import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { requireUser } from "@/lib/auth/server";
import { listFormAudienceOptions } from "@/lib/forms/server";
import { hasPermission } from "@/lib/rbac";
import { ProductionSubnav } from "../../production-subnav";
import { FormBuilder } from "../_components/form-builder";

export const metadata = {
  title: "New form · Forms · Production · PSP",
};

export const dynamic = "force-dynamic";

export default async function NewFormPage() {
  const user = await requireUser();
  if (!hasPermission(user, "forms.act")) {
    redirect("/production/forms");
  }

  const audienceOptions = await listFormAudienceOptions();
  // New form → no assignments yet. Pass an empty array so the
  // AssignmentsCard renders its "save first" hint.
  const assignments: never[] = [];

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto w-full space-y-6">
          <div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
            >
              <Link href="/production/forms">
                <ChevronLeft className="mr-1 size-4" />
                Back to forms
              </Link>
            </Button>
          </div>

          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              <ClipboardCheck className="size-6 text-brand" />
              New form
            </h1>
            <p className="text-sm text-muted-foreground">
              Author the checklist here; assign it to a workstation later
              from the workstation edit page.
            </p>
          </header>

          <FormBuilder
            template={null}
            canEdit
            audienceOptions={audienceOptions}
            assignments={assignments}
          />
        </div>
      </main>
    </div>
  );
}
