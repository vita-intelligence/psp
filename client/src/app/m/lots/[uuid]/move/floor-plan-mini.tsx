"use client";

import { FloorPlanMini as Shared } from "@/components/warehouses/floor-plan-mini";

/**
 * Mobile flavour: hits the device-cookie proxy. Thin pass-through
 * to the shared SVG renderer in `components/warehouses/`.
 */
export function FloorPlanMini({
  floorUuid,
  targetLocationUuid,
}: {
  floorUuid: string;
  targetLocationUuid: string;
}) {
  return (
    <Shared
      floorUuid={floorUuid}
      targetLocationUuid={targetLocationUuid}
      apiPath={(uuid) => `/api/m/floors/${encodeURIComponent(uuid)}/plan`}
    />
  );
}
