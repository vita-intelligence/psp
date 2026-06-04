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
import { ChevronLeft } from "lucide-react";
import { StorageTagForm } from "../storage-tag-form";

export const metadata = { title: "New storage tag · Settings · PSP" };

export default async function NewStorageTagPage() {
  const user = await requireUser();
  if (!hasPermission(user, "storage_tags.manage")) {
    redirect("/settings/storage-tags");
  }

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
          <CardTitle>New storage tag</CardTitle>
          <CardDescription>
            Add a classification label that operators can pick from in the
            warehouse plan editor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StorageTagForm tag={null} canEdit />
        </CardContent>
      </Card>
    </div>
  );
}
