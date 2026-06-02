import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { listWarehouses } from "@/lib/warehouses/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Plus, Warehouse as WarehouseIcon } from "lucide-react";
import {
  ActiveSessionsBanner,
  WarehouseEditorsBadge,
} from "./active-sessions";

export const metadata = { title: "Warehouses · Settings · PSP" };

export default async function WarehousesPage() {
  const user = await requireUser();
  if (!hasPermission(user, "warehouses.view")) {
    redirect("/settings/profile");
  }

  const warehouses = await listWarehouses();
  const canCreate = hasPermission(user, "warehouses.create");

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>Warehouses</CardTitle>
            <CardDescription>
              Physical stock locations. Each warehouse can override the
              company-wide timezone, working hours, and holidays.
            </CardDescription>
          </div>
          {canCreate && warehouses.length > 0 && (
            <Button asChild size="sm">
              <Link href="/settings/warehouses/new">
                <Plus className="mr-1.5 size-4" />
                New warehouse
              </Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Realtime: who's drafting a new warehouse right now. Renders
            nothing if nobody else is on /settings/warehouses/new. */}
        <ActiveSessionsBanner
          currentUserId={user.id}
          canCreate={canCreate}
        />

        {warehouses.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border/60 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <WarehouseIcon className="size-6 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">No warehouses yet</p>
              <p className="text-xs text-muted-foreground">
                Add your first physical location to start tracking stock.
              </p>
            </div>
            {canCreate && (
              <Button asChild size="sm">
                <Link href="/settings/warehouses/new">
                  <Plus className="mr-1.5 size-4" />
                  New warehouse
                </Link>
              </Button>
            )}
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {warehouses.map((w) => (
              <li key={w.id}>
                <Link
                  href={`/settings/warehouses/${w.id}`}
                  className="block rounded-lg border border-border/60 bg-background p-4 transition-colors hover:border-border hover:bg-muted/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate text-sm font-semibold">
                        {w.name}
                      </p>
                      {w.code && (
                        <p className="font-mono text-xs text-muted-foreground">
                          {w.code}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <WarehouseEditorsBadge
                        warehouseId={w.id}
                        currentUserId={user.id}
                      />
                      {!w.is_active && (
                        <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Inactive
                        </span>
                      )}
                    </div>
                  </div>
                  {w.address && (
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                      {w.address}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
