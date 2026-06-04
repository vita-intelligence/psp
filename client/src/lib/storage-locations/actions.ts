"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { StorageLocation } from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type LocationResult =
  | { ok: true; storage_location: StorageLocation }
  | ErrorResult;

interface LocationInput {
  floor_uuid?: string;
  name: string;
  code?: string | null;
  kind?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  width_m?: string | null;
  height_m?: string | null;
  depth_m?: string | null;
  capacity?: string | null;
  notes?: string | null;
}

export async function createLocationAction(
  warehouseUuid: string,
  input: LocationInput,
): Promise<LocationResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createLocationAction");

  try {
    const res = await api<{ storage_location: StorageLocation }>(
      `/api/warehouses/${warehouseUuid}/storage-locations`,
      {
        method: "POST",
        token,
        body: JSON.stringify(input),
      },
    );
    revalidatePath(`/settings/warehouses/${warehouseUuid}`);
    return { ok: true, storage_location: res.storage_location };
  } catch (err) {
    return toErrorResult(err, {
      source: "createLocationAction",
      fallbackDetail: "Couldn't create the storage location.",
    });
  }
}

export async function updateLocationAction(
  warehouseUuid: string,
  locationUuid: string,
  input: Partial<LocationInput>,
): Promise<LocationResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateLocationAction");

  try {
    const res = await api<{ storage_location: StorageLocation }>(
      `/api/warehouses/${warehouseUuid}/storage-locations/${locationUuid}`,
      {
        method: "PUT",
        token,
        body: JSON.stringify(input),
      },
    );
    revalidatePath(`/settings/warehouses/${warehouseUuid}`);
    return { ok: true, storage_location: res.storage_location };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateLocationAction",
      fallbackDetail: "Couldn't save the storage location.",
    });
  }
}

export async function deleteLocationAction(
  warehouseUuid: string,
  locationUuid: string,
): Promise<{ ok: true } | ErrorResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deleteLocationAction");

  try {
    await api(
      `/api/warehouses/${warehouseUuid}/storage-locations/${locationUuid}`,
      { method: "DELETE", token },
    );
    revalidatePath(`/settings/warehouses/${warehouseUuid}`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteLocationAction",
      fallbackDetail: "Couldn't delete the storage location.",
    });
  }
}
