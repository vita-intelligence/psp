"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { StorageCell, StorageCellPurpose } from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type CellResult =
  | { ok: true; cell: StorageCell }
  | ErrorResult;

export type DeleteResult = { ok: true } | ErrorResult;

interface CellInput {
  ordinal?: number;
  name?: string | null;
  width_m?: string | number | null;
  depth_m?: string | number | null;
  height_m?: string | number | null;
  max_weight_kg?: string | number | null;
  tags?: string[];
  /** Cell intent — drives the auto-router. */
  purpose?: StorageCellPurpose;
  notes?: string | null;
}

export async function createCellAction(
  warehouseUuid: string,
  locationUuid: string,
  input: CellInput,
): Promise<CellResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createCellAction");

  try {
    const res = await api<{ cell: StorageCell }>(
      `/api/warehouses/${warehouseUuid}/storage-locations/${locationUuid}/cells`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/settings/warehouses/${warehouseUuid}`);
    return { ok: true, cell: res.cell };
  } catch (err) {
    return toErrorResult(err, {
      source: "createCellAction",
      fallbackDetail: "Couldn't add the cell.",
    });
  }
}

export async function updateCellAction(
  warehouseUuid: string,
  locationUuid: string,
  cellUuid: string,
  input: CellInput,
): Promise<CellResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateCellAction");

  try {
    const res = await api<{ cell: StorageCell }>(
      `/api/warehouses/${warehouseUuid}/storage-locations/${locationUuid}/cells/${cellUuid}`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/settings/warehouses/${warehouseUuid}`);
    return { ok: true, cell: res.cell };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateCellAction",
      fallbackDetail: "Couldn't update the cell.",
    });
  }
}

export type SplitResult =
  | { ok: true; cells: StorageCell[] }
  | ErrorResult;

export type SyncTagsResult =
  | { ok: true; updated: number }
  | ErrorResult;

/**
 * Push the rack's current tag set down to every level. Used by the
 * confirm prompt that fires after a rack tag edit when existing
 * levels already had their own tags. Tag inheritance is otherwise
 * creation-time only.
 */
export async function syncCellTagsAction(
  warehouseUuid: string,
  locationUuid: string,
): Promise<SyncTagsResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("syncCellTagsAction");

  try {
    const res = await api<{ updated: number }>(
      `/api/warehouses/${warehouseUuid}/storage-locations/${locationUuid}/cells/sync-tags`,
      { method: "POST", token, body: "{}" },
    );
    revalidatePath(`/settings/warehouses/${warehouseUuid}`);
    return { ok: true, updated: res.updated };
  } catch (err) {
    return toErrorResult(err, {
      source: "syncCellTagsAction",
      fallbackDetail: "Couldn't apply the rack's tags to its levels.",
    });
  }
}

/**
 * Seed N cells onto a location in one round-trip. Each entry of
 * `heights_m` becomes one level; ordinals start at the location's
 * next free slot so calling this on a rack that already has cells
 * appends rather than overwrites.
 */
export async function splitCellsAction(
  warehouseUuid: string,
  locationUuid: string,
  heights_m: number[],
): Promise<SplitResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("splitCellsAction");

  try {
    const res = await api<{ cells: StorageCell[] }>(
      `/api/warehouses/${warehouseUuid}/storage-locations/${locationUuid}/cells/split`,
      { method: "POST", token, body: JSON.stringify({ heights_m }) },
    );
    revalidatePath(`/settings/warehouses/${warehouseUuid}`);
    return { ok: true, cells: res.cells };
  } catch (err) {
    return toErrorResult(err, {
      source: "splitCellsAction",
      fallbackDetail: "Couldn't split the rack into levels.",
    });
  }
}

export async function deleteCellAction(
  warehouseUuid: string,
  locationUuid: string,
  cellUuid: string,
): Promise<DeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deleteCellAction");

  try {
    await api<void>(
      `/api/warehouses/${warehouseUuid}/storage-locations/${locationUuid}/cells/${cellUuid}`,
      { method: "DELETE", token },
    );
    revalidatePath(`/settings/warehouses/${warehouseUuid}`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteCellAction",
      fallbackDetail: "Couldn't delete the cell.",
    });
  }
}
