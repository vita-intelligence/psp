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
import { listStorageTagsPage } from "@/lib/storage-tags/server";
import { StorageTagsTable } from "./storage-tags-table";

export const metadata = { title: "Storage tags · Settings · PSP" };

export default async function StorageTagsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "warehouses.view")) {
    redirect("/settings/profile");
  }

  const initialPage = await listStorageTagsPage();
  const canEdit = hasPermission(user, "storage_tags.manage");

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle>Storage tags</CardTitle>
            <CardDescription>
              Company-wide classification vocabulary used to tag storage
              locations and shelves. Operators pick from this list in the
              warehouse plan editor; allocation later matches items against
              the same keys, so consistent spelling matters.
            </CardDescription>
          </div>
          {canEdit && (
            <Button asChild size="sm" className="shrink-0">
              <Link href="/settings/storage-tags/new">
                <Plus className="mr-1.5 size-4" />
                New tag
              </Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <StorageTagsTable
          initialPage={initialPage ?? { items: [], next_cursor: null }}
        />
      </CardContent>
    </Card>
  );
}
