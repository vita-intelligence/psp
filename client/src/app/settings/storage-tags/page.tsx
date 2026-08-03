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
import { ExternalLink, Info, Lock, Plus } from "lucide-react";
import { listStorageTagsPage } from "@/lib/storage-tags/server";
import { CELL_PURPOSES } from "@/lib/storage-cells/purpose";
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
      <CardContent className="space-y-5">
        {/* Signpost: cell purposes vs storage tags is the #1 source
            of confusion here. The auto-router only reads
            `cell.purpose` (a fixed enum baked into the schema); tags
            are freeform classification only. */}
        <div className="flex items-start gap-2 rounded-md border border-sky-500/40 bg-sky-500/5 px-3 py-2 text-xs text-sky-900 dark:text-sky-100">
          <Info className="mt-0.5 size-4 shrink-0" />
          <p>
            The seven <span className="font-semibold">cell purposes</span> below
            are reserved system keys — they drive the auto-router and are set
            per cell in the{" "}
            <Link
              href="/settings/warehouses"
              className="font-medium underline underline-offset-2"
            >
              Warehouse plan editor
            </Link>{" "}
            under a cell&apos;s <span className="font-semibold">Purpose</span>{" "}
            dropdown, not here. The freeform vocabulary below the strip is
            what you use for your own classification labels.
          </p>
        </div>

        {/* System reserved purposes — the fixed enum, rendered so
            they're findable + searchable on this page even though
            they're not managed here. Each row deep-links to the
            plan editor where the actual assignment happens. */}
        <section className="space-y-2">
          <div>
            <h3 className="text-sm font-semibold">System reserved</h3>
            <p className="text-xs text-muted-foreground">
              Cell purposes — set on individual cells via the warehouse plan
              editor. Can&apos;t be created, renamed, or deleted here.
            </p>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {CELL_PURPOSES.map((p) => (
              <li
                key={p.value}
                className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2"
              >
                <span
                  className={`mt-0.5 inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${p.chipClassName}`}
                >
                  {p.label}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {p.value}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {p.description}
                  </p>
                </div>
                <Lock
                  className="mt-1 size-3.5 shrink-0 text-muted-foreground"
                  aria-label="System reserved"
                />
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">
            <Link
              href="/settings/warehouses"
              className="inline-flex items-center gap-1 font-medium underline underline-offset-2"
            >
              Open warehouses
              <ExternalLink className="size-3" />
            </Link>{" "}
            → pick a warehouse → open the plan editor → click a cell → set
            its Purpose.
          </p>
        </section>

        <section className="space-y-2">
          <div>
            <h3 className="text-sm font-semibold">Your tags</h3>
            <p className="text-xs text-muted-foreground">
              Freeform classification vocabulary managed by your team.
            </p>
          </div>
          <StorageTagsTable
            initialPage={initialPage ?? { items: [], next_cursor: null }}
          />
        </section>
      </CardContent>
    </Card>
  );
}
