"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError } from "../api";
import { getSessionToken } from "../auth/server";
import type { Warehouse } from "../types";
import type { ErrorResult } from "../auth/actions";

export type WarehouseResult =
  | { ok: true; warehouse: Warehouse }
  | ErrorResult;

function toErrorResult(err: unknown): ErrorResult {
  if (err instanceof ApiError) {
    return {
      ok: false,
      code: err.code,
      detail: err.detail,
      fields: err.fields,
    };
  }
  return {
    ok: false,
    code: "unknown",
    detail: "Something went wrong. Please try again.",
  };
}

export async function createWarehouseAction(
  input: Partial<Warehouse>,
): Promise<WarehouseResult> {
  const token = await getSessionToken();
  if (!token)
    return { ok: false, code: "unauthorized", detail: "Sign in first." };

  try {
    const res = await api<{ warehouse: Warehouse }>("/api/warehouses", {
      method: "POST",
      token,
      body: JSON.stringify(input),
    });
    revalidatePath("/settings/warehouses");
    return { ok: true, warehouse: res.warehouse };
  } catch (err) {
    return toErrorResult(err);
  }
}

export async function updateWarehouseAction(
  uuid: string,
  input: Partial<Warehouse>,
): Promise<WarehouseResult> {
  const token = await getSessionToken();
  if (!token)
    return { ok: false, code: "unauthorized", detail: "Sign in first." };

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
    return toErrorResult(err);
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
