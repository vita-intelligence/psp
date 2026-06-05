import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Plus } from "lucide-react";
import { listItemsPage } from "@/lib/items/server";
import { ItemsTable } from "./items-table";

export const metadata = { title: "Items · Settings · PSP" };

export default async function ItemsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "items.view")) {
    redirect("/settings/profile");
  }

  const initialPage = await listItemsPage();
  const canCreate = hasPermission(user, "items.create");

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle>Items</CardTitle>
            <CardDescription>
              Raw materials, semi-finished, finished products, and packaging.
              Each item carries identity here; per-type compliance and risk
              data live in the dedicated sub-forms.
            </CardDescription>
          </div>
          {canCreate && (
            <Button asChild size="sm" className="shrink-0">
              <Link href="/settings/items/new">
                <Plus className="mr-1.5 size-4" />
                New item
              </Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <ItemsTable
          initialPage={initialPage ?? { items: [], next_cursor: null }}
        />
      </CardContent>
    </Card>
  );
}
