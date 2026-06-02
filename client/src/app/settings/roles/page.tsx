import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { listTemplatesFirstPage } from "@/lib/templates/server";
import { hasPermission } from "@/lib/rbac";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { TemplateActiveSessionsBanner } from "./active-sessions";
import { TemplatesTable } from "./templates-table";

export const metadata = { title: "Templates · Settings · PSP" };

export default async function TemplatesListPage() {
  const user = await requireUser();
  if (!hasPermission(user, "roles.view")) {
    redirect("/settings/profile");
  }

  const initialPage = await listTemplatesFirstPage();
  const canCreate = hasPermission(user, "roles.create");

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle>Permission templates</CardTitle>
            <CardDescription>
              Saved combinations of permissions. Apply one to a user from
              the access page to fill in the matrix without ticking
              every box by hand.
            </CardDescription>
          </div>
          {canCreate && (
            <Button asChild size="sm" className="shrink-0">
              <Link href="/settings/roles/new">
                <Plus className="mr-1.5 size-4" />
                New template
              </Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <TemplatesTable
          initialPage={initialPage}
          currentUserId={user.id}
          beforeTable={
            <TemplateActiveSessionsBanner
              currentUserId={user.id}
              canCreate={canCreate}
            />
          }
        />
      </CardContent>
    </Card>
  );
}
