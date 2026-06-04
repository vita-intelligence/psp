"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { Warehouse } from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type WarehouseResult =
  | { ok: true; warehouse: Warehouse }
  | ErrorResult;

export async function createWarehouseAction(
  input: Partial<Warehouse>,
): Promise<WarehouseResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createWarehouseAction");

  try {
    const res = await api<{ warehouse: Warehouse }>("/api/warehouses", {
      method: "POST",
      token,
      body: JSON.stringify(input),
    });
    revalidatePath("/settings/warehouses");
    return { ok: true, warehouse: res.warehouse };
  } catch (err) {
    return toErrorResult(err, {
      source: "createWarehouseAction",
      fallbackDetail: "Couldn't create the warehouse.",
    });
  }
}

export async function updateWarehouseAction(
  uuid: string,
  input: Partial<Warehouse>,
): Promise<WarehouseResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateWarehouseAction");

  try {
    const res = await api<{ warehouse: Warehouse }>(
      `/api/warehouses/${uuid}`,
      {
        method: "PUT",
        token,
        body: JSON.stringify(input),
      },
    );
    revalidatePath(`/settings/warehouses/${uuid}`);
    revalidatePath("/settings/warehouses");
    return { ok: true, warehouse: res.warehouse };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateWarehouseAction",
      fallbackDetail: "Couldn't save the warehouse.",
    });
  }
}

export async function deleteWarehouseAction(uuid: string): Promise<void> {
  const token = await getSessionToken();
  if (!token) return;

  try {
    await api(`/api/warehouses/${uuid}`, { method: "DELETE", token });
  } catch {
    // best-effort — UI shows a toast on the optimistic side
  }
  revalidatePath("/settings/warehouses");
  redirect("/settings/warehouses");
}
