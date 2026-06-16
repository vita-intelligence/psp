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

// ---------------------------------------------------------------
// Production facilities — sibling surface on the same warehouses
// table, distinguished by the `kind` discriminator. Same Warehouse
// payload shape; different REST namespace + revalidation paths.
// ---------------------------------------------------------------

export async function createProductionFacilityAction(
  input: Partial<Warehouse>,
): Promise<WarehouseResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createProductionFacilityAction");

  try {
    const res = await api<{ warehouse: Warehouse }>(
      "/api/production-facilities",
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath("/settings/production-sites");
    return { ok: true, warehouse: res.warehouse };
  } catch (err) {
    return toErrorResult(err, {
      source: "createProductionFacilityAction",
      fallbackDetail: "Couldn't create the production site.",
    });
  }
}

export async function updateProductionFacilityAction(
  uuid: string,
  input: Partial<Warehouse>,
): Promise<WarehouseResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateProductionFacilityAction");

  try {
    const res = await api<{ warehouse: Warehouse }>(
      `/api/production-facilities/${uuid}`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/settings/production-sites/${uuid}`);
    revalidatePath("/settings/production-sites");
    return { ok: true, warehouse: res.warehouse };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateProductionFacilityAction",
      fallbackDetail: "Couldn't save the production site.",
    });
  }
}

export async function deleteProductionFacilityAction(
  uuid: string,
): Promise<void> {
  const token = await getSessionToken();
  if (!token) return;

  try {
    await api(`/api/production-facilities/${uuid}`, {
      method: "DELETE",
      token,
    });
  } catch {
    // best-effort — UI surfaces toast on the optimistic side
  }
  revalidatePath("/settings/production-sites");
  redirect("/settings/production-sites");
}
