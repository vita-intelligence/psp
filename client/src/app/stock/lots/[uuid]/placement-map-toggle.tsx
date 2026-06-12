"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, MapPin } from "lucide-react";
import { FloorPlanMini } from "@/components/warehouses/floor-plan-mini";

interface Props {
  floorUuid: string;
  locationUuid: string;
  /** Code or name of the highlighted location — surfaced in the
   *  collapsed button so the operator knows what's being mapped
   *  without expanding it first. */
  locationLabel: string;
}

/**
 * Per-placement "Show on plan" toggle. Collapsed by default so the
 * placements card stays compact when a lot is split across multiple
 * cells; expanded reveals the shared `FloorPlanMini` widget with the
 * rack pinned. Same SVG renderer the mobile move-flow uses, just
 * proxied through the session-cookie endpoint.
 */
export function PlacementMapToggle({
  floorUuid,
  locationUuid,
  locationLabel,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-md border border-border/40 bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground"
      >
        <MapPin className="size-3.5 shrink-0" />
        <span className="flex-1">
          {open ? "Hide on plan" : "Show on plan"}
          <span className="ml-1 font-mono text-muted-foreground/80">
            · {locationLabel}
          </span>
        </span>
        {open ? (
          <ChevronUp className="size-3.5 shrink-0" />
        ) : (
          <ChevronDown className="size-3.5 shrink-0" />
        )}
      </button>
      {open && (
        <div className="p-2">
          <FloorPlanMini
            floorUuid={floorUuid}
            targetLocationUuid={locationUuid}
            apiPath={(uuid) =>
              `/api/stock/floors/${encodeURIComponent(uuid)}/plan`
            }
            footerLabel="pinned rack is where this stock sits."
            heightClassName="h-72"
          />
        </div>
      )}
    </div>
  );
}
