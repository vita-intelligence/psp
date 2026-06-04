import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { listStorageTags } from "@/lib/storage-tags/server";
import { hasPermission } from "@/lib/rbac";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StorageTagsManager } from "./storage-tags-manager";

export const metadata = { title: "Storage tags · Settings · PSP" };

export default async function StorageTagsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "warehouses.view")) {
    redirect("/settings/profile");
  }

  const tags = (await listStorageTags()) ?? [];
  const canEdit = hasPermission(user, "warehouses.edit");

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="space-y-1.5">
          <CardTitle>Storage tags</CardTitle>
          <CardDescription>
            The company-wide vocabulary used to classify storage
            locations and shelves. Operators pick from this list when
            tagging a rack or a level; allocation later matches items
            against the same keys. Keep entries lowercase and
            hyphen-separated (<span className="font-mono">cold-zone</span>,{" "}
            <span className="font-mono">hazmat-3</span>) so the picker
            and the matcher agree on equality.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <StorageTagsManager initialTags={tags} canEdit={canEdit} />
      </CardContent>
    </Card>
  );
}
