import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge-mini";
import { listFloors } from "@/lib/floors/server";
import { LayoutGrid, Layers, Square } from "lucide-react";
import { NewFloorButton } from "./new-floor-button";

interface PlanTabProps {
  warehouseUuid: string;
  warehouseName: string;
  canEdit: boolean;
}

/**
 * Plan tab on the warehouse detail page. For Phase 3 this is just a
 * floor-list placeholder — the canvas editor lands in Phase 4 and
 * will replace the body of this card while keeping the header.
 *
 * Server component so the first paint already has floors. The
 * "Add floor" CTA is a client component that triggers
 * `router.refresh()` after creating, re-rendering this server tree
 * with the new row.
 */
export async function PlanTab({
  warehouseUuid,
  warehouseName,
  canEdit,
}: PlanTabProps) {
  const floors = await listFloors(warehouseUuid);

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <LayoutGrid className="size-4 text-muted-foreground" />
              Floor plans
            </CardTitle>
            <CardDescription>
              Draw the layout of {warehouseName} and place storage
              locations. Each floor has its own plan; the canvas editor
              lands in the next phase.
            </CardDescription>
          </div>
          {canEdit && (
            <NewFloorButton
              warehouseUuid={warehouseUuid}
              suggestedName={
                floors.length === 0 ? "Ground floor" : `Floor ${floors.length}`
              }
            />
          )}
        </div>
      </CardHeader>
      <CardContent>
        {floors.length === 0 ? (
          <EmptyState canEdit={canEdit} />
        ) : (
          <ul className="divide-y divide-border/40 rounded-md border border-border/40">
            {floors.map((floor) => {
              const count = floor.storage_locations?.length ?? 0;
              return (
                <li
                  key={floor.id}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
                    <Layers className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {floor.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      Ordinal {floor.ordinal} ·{" "}
                      {count === 0
                        ? "no locations yet"
                        : `${count} location${count === 1 ? "" : "s"}`}
                    </p>
                  </div>
                  <Badge tone="muted">
                    <Square className="mr-1 size-3" />
                    Canvas coming
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState({ canEdit }: { canEdit: boolean }) {
  return (
    <div className="rounded-md border border-dashed border-border/60 py-12 text-center">
      <LayoutGrid className="mx-auto size-8 text-muted-foreground" />
      <p className="mt-3 text-sm font-medium">No floors yet</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {canEdit
          ? "Add at least one floor to start drawing the plan."
          : "An editor will need to add the first floor."}
      </p>
    </div>
  );
}
