import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { getStorageTag } from "@/lib/storage-tags/server";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChevronLeft } from "lucide-react";
import { EditModeToggle } from "@/components/forms/edit-mode-toggle";
import { StorageTagForm } from "../storage-tag-form";

export const metadata = { title: "Edit storage tag · Settings · PSP" };

export default async function EditStorageTagPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const { uuid } = await params;
  const user = await requireUser();
  if (!hasPermission(user, "warehouses.view")) {
    redirect("/settings/profile");
  }

  const tag = await getStorageTag(uuid);
  if (!tag) notFound();

  const canEdit = hasPermission(user, "storage_tags.manage");

  return (
    <div className="space-y-4">
      <div>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
        >
          <Link href="/settings/storage-tags">
            <ChevronLeft className="mr-1 size-4" />
            Back to tags
          </Link>
        </Button>
      </div>
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>{tag.label}</CardTitle>
          <CardDescription>
            <span className="font-mono text-xs">{tag.key}</span>
            {!canEdit && (
              <span className="ml-2 text-muted-foreground">
                (read-only — needs <span className="font-mono">storage_tags.manage</span>)
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EditModeToggle canEdit={canEdit}>
            <StorageTagForm tag={tag} canEdit={canEdit} />
          </EditModeToggle>
        </CardContent>
      </Card>
    </div>
  );
}
