import Link from "next/link";
import { redirect } from "next/navigation";
import { Package, Plus } from "lucide-react";
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
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { listItemsPage } from "@/lib/items/server";
import { ActiveSessionsBanner } from "@/components/realtime/active-sessions";
import { ProductionSubnav } from "../production-subnav";
import { ItemsTable } from "./items-table";

export const metadata = { title: "Items · Production · PSP" };

export default async function ItemsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "items.view")) {
    redirect("/settings/profile");
  }

  const initialPage = await listItemsPage();
  const canCreate = hasPermission(user, "items.create");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            icon={Package}
            title="Items"
            description="Raw materials, semi-finished blends, finished products, packaging, and equipment — the catalogue every BOM / MO / stock lot reads from."
            actions={
              canCreate ? (
                <Button asChild size="sm">
                  <Link href="/production/items/new">
                    <Plus className="mr-1.5 size-4" />
                    New item
                  </Link>
                </Button>
              ) : undefined
            }
          />

          <Card className="border-border/60">
            <CardHeader>
              <div className="min-w-0 space-y-1.5">
                <CardTitle>Catalogue</CardTitle>
                <CardDescription>
                  Each item carries identity here; per-type compliance and
                  risk data live in the dedicated sub-forms.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <ActiveSessionsBanner
                currentUserId={user.id}
                resourcePrefix="item"
                newRoute="/production/items/new"
                resourceLabel="item"
                canCreate={canCreate}
              />
              <ItemsTable
                initialPage={initialPage ?? { items: [], next_cursor: null }}
              />
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
