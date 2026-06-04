import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listFloors } from "@/lib/floors/server";
import { LayoutGrid } from "lucide-react";
import { NewFloorButton } from "./new-floor-button";
import { WarehousePlanEditor } from "./plan/warehouse-plan-editor";

interface PlanTabProps {
  warehouseUuid: string;
  warehouseId: number;
  warehouseName: string;
  canEdit: boolean;
}

/**
 * Plan tab on the warehouse detail page. Server-fetches the floors
 * list (with storage_locations preloaded) and hands them to the
 * client-side editor for rendering + editing.
 *
 * Empty-state shows when no floors exist yet — user adds the first
 * floor before the canvas comes alive.
 */
export async function PlanTab({
  warehouseUuid,
  warehouseId,
  warehouseName,
  canEdit,
}: PlanTabProps) {
  const floors = await listFloors(warehouseUuid);

  if (floors.length === 0) {
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
                locations. Add your first floor to get started.
              </CardDescription>
            </div>
            {canEdit && (
              <NewFloorButton
                warehouseUuid={warehouseUuid}
                suggestedName="Ground floor"
              />
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-dashed border-border/60 py-12 text-center">
            <LayoutGrid className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No floors yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {canEdit
                ? "Add at least one floor to start drawing the plan."
                : "An editor will need to add the first floor."}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <WarehousePlanEditor
      warehouseUuid={warehouseUuid}
      warehouseId={warehouseId}
      warehouseName={warehouseName}
      floors={floors}
      canEdit={canEdit}
    />
  );
}
