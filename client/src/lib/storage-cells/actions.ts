"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { StorageCell } from "../types";
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
