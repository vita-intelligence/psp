"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { Item, ItemType } from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type ItemResult = { ok: true; item: Item } | ErrorResult;
export type DeleteResult = { ok: true } | ErrorResult;

interface ItemInput {
  name?: string;
  description?: string | null;
  item_type?: ItemType;
  external_sku?: string | null;
  barcode?: string | null;
  stock_uom_id?: number | null;
  product_family_id?: number | null;
  attributes?: Record<string, unknown>;
  is_active?: boolean;
}

export async function createItemAction(input: ItemInput): Promise<ItemResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createItemAction");

  try {
    const res = await api<{ item: Item }>(`/api/items`, {
      method: "POST",
      token,
      body: JSON.stringify(input),
    });
    revalidatePath(`/settings/items`);
    return { ok: true, item: res.item };
  } catch (err) {
    return toErrorResult(err, {
      source: "createItemAction",
      fallbackDetail: "Couldn't create the item.",
    });
  }
}

export async function updateItemAction(
  uuid: string,
  input: ItemInput,
): Promise<ItemResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateItemAction");

  try {
    const res = await api<{ item: Item }>(`/api/items/${uuid}`, {
      method: "PUT",
      token,
      body: JSON.stringify(input),
    });
    revalidatePath(`/settings/items`);
    return { ok: true, item: res.item };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateItemAction",
      fallbackDetail: "Couldn't update the item.",
    });
  }
}

/** Atomic mega-save: identity + per-type compliance subtable in one
 *  transaction. The single-source-of-truth save path for the unified
 *  item edit form. */
export async function updateItemFullAction(
  uuid: string,
  input: {
    item?: ItemInput;
    raw_material_compliance?: Record<string, unknown> | null;
    raw_material_risk?: Record<string, unknown> | null;
    finished_product_spec?: Record<string, unknown> | null;
    packaging_compliance?: Record<string, unknown> | null;
    /** Full-replace set of allergen UUIDs (raw material only). */
    allergen_uuids?: string[] | null;
  },
): Promise<ItemResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateItemFullAction");

  try {
    const res = await api<{ item: Item }>(`/api/items/${uuid}/full`, {
      method: "PUT",
      token,
      body: JSON.stringify(input),
    });
    revalidatePath(`/settings/items`);
    revalidatePath(`/settings/items/${uuid}`);
    return { ok: true, item: res.item };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateItemFullAction",
      fallbackDetail: "Couldn't save the item.",
    });
  }
}

export async function deleteItemAction(uuid: string): Promise<DeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deleteItemAction");

  try {
    await api<void>(`/api/items/${uuid}`, { method: "DELETE", token });
    revalidatePath(`/settings/items`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteItemAction",
      fallbackDetail: "Couldn't delete the item.",
    });
  }
}
