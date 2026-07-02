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
import { Info, Plus } from "lucide-react";
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
      <CardContent className="space-y-4">
        {/* Signpost: cell purposes vs storage tags is the #1 source
            of confusion here. The auto-router only reads
            `cell.purpose` (a fixed enum baked into the schema); tags
            are freeform classification only. Point people at the
            right place when they can't find "finished_quarantine" /
            "quarantine" / "hold" etc. in this list. */}
        <div className="flex items-start gap-2 rounded-md border border-sky-500/40 bg-sky-500/5 px-3 py-2 text-xs text-sky-900 dark:text-sky-100">
          <Info className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold">
              Cell purposes are separate from tags.
            </p>
            <p>
              <span className="font-mono">
                regular · quarantine · hold · rejected · dispatch ·
                production_feed · finished_quarantine
              </span>{" "}
              are the seven typed <span className="font-semibold">cell purposes</span>{" "}
              — set them per cell in the{" "}
              <Link
                href="/settings/warehouses"
                className="font-medium underline underline-offset-2"
              >
                Warehouses plan editor
              </Link>{" "}
              under the cell dialog&apos;s <span className="font-semibold">Purpose</span>{" "}
              dropdown. The auto-router only reads that column; a
              freeform tag with the same key won&apos;t route
              anything, so those keys are reserved and can&apos;t be
              added below.
            </p>
          </div>
        </div>

        <StorageTagsTable
          initialPage={initialPage ?? { items: [], next_cursor: null }}
        />
      </CardContent>
    </Card>
  );
}
