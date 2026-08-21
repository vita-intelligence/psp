"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { Floor } from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type FloorResult = { ok: true; floor: Floor } | ErrorResult;

/**
 * Create a new floor on the warehouse. The backend auto-assigns
 * `ordinal` to "next available" so floors append to the bottom of
 * the switcher.
 */
export async function createFloorAction(
  warehouseUuid: string,
  input: { name: string },
): Promise<FloorResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createFloorAction");

  try {
    const res = await api<{ floor: Floor }>(
      `/api/warehouses/${warehouseUuid}/floors`,
      {
        method: "POST",
        token,
        body: JSON.stringify(input),
      },
    );
    revalidatePath(`/settings/warehouses/${warehouseUuid}`);
    return { ok: true, floor: res.floor };
  } catch (err) {
    return toErrorResult(err, {
      source: "createFloorAction",
      fallbackDetail: "Couldn't create the floor.",
    });
  }
}

/**
 * Rename a floor or replace its canvas_json. Reordering (changing
 * `ordinal`) is also routed here — the editor sends one update per
 * drag end, not per swap.
 */
export async function updateFloorAction(
  warehouseUuid: string,
  floorUuid: string,
  input: Partial<Pick<Floor, "name" | "ordinal" | "canvas_json">>,
): Promise<FloorResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateFloorAction");

  try {
    const res = await api<{ floor: Floor }>(
      `/api/warehouses/${warehouseUuid}/floors/${floorUuid}`,
      {
        method: "PUT",
        token,
        body: JSON.stringify(input),
      },
    );
    revalidatePath(`/settings/warehouses/${warehouseUuid}`);
    return { ok: true, floor: res.floor };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateFloorAction",
      fallbackDetail: "Couldn't save the floor.",
    });
  }
}

/**
 * Narrow autosave-friendly PATCH for the floor's canvas_json alone.
 * Backend accepts only `canvas_json` on this route so we can fire it
 * repeatedly during a live-edit session without shipping name /
 * ordinal on every keystroke.
 *
 * Prefer this over `updateFloorAction` inside the plan-editor
 * autosave loop; keep `updateFloorAction` for the metadata edits
 * (rename, reorder) that come from the floor switcher.
 */
export async function patchFloorCanvasAction(
  warehouseUuid: string,
  floorUuid: string,
  canvasJson: Record<string, unknown>,
): Promise<FloorResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("patchFloorCanvasAction");

  try {
    const res = await api<{ floor: Floor }>(
      `/api/warehouses/${warehouseUuid}/floors/${floorUuid}/canvas`,
      {
        method: "PATCH",
        token,
        body: JSON.stringify({ canvas_json: canvasJson }),
      },
    );
    // No revalidatePath — autosave fires often, and the plan editor
    // holds live state locally. Skipping the revalidate keeps the
    // save latency to one round-trip.
    return { ok: true, floor: res.floor };
  } catch (err) {
    return toErrorResult(err, {
      source: "patchFloorCanvasAction",
      fallbackDetail: "Couldn't save the floor.",
    });
  }
}

export async function deleteFloorAction(
  warehouseUuid: string,
  floorUuid: string,
): Promise<{ ok: true } | ErrorResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deleteFloorAction");

  try {
    await api(`/api/warehouses/${warehouseUuid}/floors/${floorUuid}`, {
      method: "DELETE",
      token,
    });
    revalidatePath(`/settings/warehouses/${warehouseUuid}`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteFloorAction",
      fallbackDetail: "Couldn't delete the floor.",
    });
  }
}
