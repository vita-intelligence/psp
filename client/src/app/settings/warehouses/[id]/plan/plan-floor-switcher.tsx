"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Floor } from "@/lib/types";
import { Layers, Plus } from "lucide-react";

interface PlanFloorSwitcherProps {
  floors: Floor[];
  activeFloorId: number | null;
  onSelect: (floorId: number) => void;
  onAddFloor: () => void;
  canAdd: boolean;
  /** When true, the active floor tab shows a pulsing dot — visual
   *  hint that switching now will discard unsaved work on the
   *  current floor. */
  hasUnsavedChanges?: boolean;
}

/**
 * Bottom tabs that swap which floor is currently rendered on the
 * canvas. One tab per floor, "Add floor" button trailing. Disabled
 * styling when the user lacks edit permission.
 */
export function PlanFloorSwitcher({
  floors,
  activeFloorId,
  onSelect,
  onAddFloor,
  canAdd,
  hasUnsavedChanges = false,
}: PlanFloorSwitcherProps) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto rounded-md border border-border/60 bg-background p-1 shadow-sm">
      {floors.map((floor) => {
        const isActive = floor.id === activeFloorId;
        return (
          <button
            key={floor.id}
            type="button"
            onClick={() => onSelect(floor.id)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              isActive
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
            title={`Floor ordinal ${floor.ordinal}`}
            aria-current={isActive ? "page" : undefined}
          >
            <Layers className="size-3.5" />
            {floor.name}
            {isActive && hasUnsavedChanges && (
              <span
                aria-label="Unsaved changes"
                className="ml-0.5 inline-flex size-1.5 items-center justify-center"
              >
                <span className="absolute inline-flex size-1.5 animate-ping rounded-full bg-amber-400/60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-amber-500" />
              </span>
            )}
          </button>
        );
      })}
      {canAdd && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onAddFloor}
          className="h-7 shrink-0 gap-1 px-2 text-xs text-muted-foreground"
        >
          <Plus className="size-3" />
          Add floor
        </Button>
      )}
    </div>
  );
}
