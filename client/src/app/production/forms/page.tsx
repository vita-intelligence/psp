import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardCheck, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { requireUser } from "@/lib/auth/server";
import { listFormTemplates } from "@/lib/forms/server";
import { hasPermission } from "@/lib/rbac";
import { ProductionSubnav } from "../production-subnav";
import { FormsTable } from "./forms-table";

export const metadata = {
  title: "Forms · Production · PSP",
};

export const dynamic = "force-dynamic";

export default async function FormsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "forms.view")) {
    redirect("/");
  }

  const canEdit = hasPermission(user, "forms.act");
  const templates = await listFormTemplates({ includeInactive: true });

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            icon={ClipboardCheck}
            title="Forms"
            description="Checklists authored here and published to the vita-performance kiosk. Assign each form to workstations as start-of-shift, end-of-shift, or cleaning — cleaning templates expand equipment sections automatically at publish time."
            actions={
              canEdit ? (
                <Button asChild size="sm">
                  <Link href="/production/forms/new">
                    <Plus className="mr-1.5 size-4" />
                    New form
                  </Link>
                </Button>
              ) : null
            }
          />

          <Card className="border-border/60">
            <CardHeader className="space-y-1.5">
              <CardTitle>Library</CardTitle>
              <CardDescription>
                Every template shows its trigger, current version, and whether
                unpublished changes are pending. Archived templates keep working
                on workstations that already reference them, but are hidden
                from new assignments.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FormsTable initial={templates} canEdit={canEdit} />
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
