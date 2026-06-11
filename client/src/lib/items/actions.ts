"use server";

import { revalidatePath } from "next/cache";
import { api, ApiError } from "../api";
import { getSessionToken } from "../auth/server";
import type {
  Item,
  ItemComplianceBlocker,
  ItemFile,
  ItemType,
} from "../types";
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
  storage_tags?: string[];
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

/** When `mark-ready` fails the validator, the backend returns the
 *  exact list of fields that still need filling. We surface those to
 *  the FE so the form can highlight every blocker in one render
 *  instead of asking the user to fix-and-retry one at a time. */
export type MarkReadyResult =
  | { ok: true; item: Item }
  | (ErrorResult & { blockers?: ItemComplianceBlocker[] });

export async function markItemReadyAction(
  uuid: string,
): Promise<MarkReadyResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("markItemReadyAction");

  try {
    const res = await api<{ item: Item }>(
      `/api/items/${encodeURIComponent(uuid)}/mark-ready`,
      { method: "POST", token },
    );
    revalidatePath(`/settings/items`);
    revalidatePath(`/settings/items/${uuid}`);
    return { ok: true, item: res.item };
  } catch (err) {
    const base = toErrorResult(err, {
      source: "markItemReadyAction",
      fallbackDetail: "Couldn't mark this item ready for use.",
    });
    // `extras.blockers` is set by the `api()` helper when the backend
    // returns the validator's missing-field list.
    const blockers =
      err instanceof ApiError
        ? (err.extras.blockers as ItemComplianceBlocker[] | undefined)
        : undefined;
    return { ...base, ...(blockers ? { blockers } : {}) };
  }
}

export async function revertItemToDraftAction(
  uuid: string,
  reason: string,
): Promise<ItemResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("revertItemToDraftAction");

  try {
    const res = await api<{ item: Item }>(
      `/api/items/${encodeURIComponent(uuid)}/revert-to-draft`,
      { method: "POST", token, body: JSON.stringify({ reason }) },
    );
    revalidatePath(`/settings/items`);
    revalidatePath(`/settings/items/${uuid}`);
    return { ok: true, item: res.item };
  } catch (err) {
    return toErrorResult(err, {
      source: "revertItemToDraftAction",
      fallbackDetail: "Couldn't revert this item to draft.",
    });
  }
}

export type UploadItemFileResult = { ok: true; file: ItemFile } | ErrorResult;

/** Multipart upload of an item compliance file (spec sheet, food-
 *  contact DoC, migration test report, …). Bytes go to `Backend.Storage`
 *  via the items file controller; the returned `file.id` is what the
 *  per-type compliance subtable's `*_file_id` references.
 *
 *  Called from a client component using `useTransition` + `FormData`. */
export async function uploadItemFileAction(
  itemUuid: string,
  formData: FormData,
): Promise<UploadItemFileResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("uploadItemFileAction");

  try {
    const res = await api<{ file: ItemFile }>(
      `/api/items/${encodeURIComponent(itemUuid)}/files`,
      { method: "POST", token, body: formData },
    );
    revalidatePath(`/settings/items/${itemUuid}`);
    return { ok: true, file: res.file };
  } catch (err) {
    return toErrorResult(err, {
      source: "uploadItemFileAction",
      fallbackDetail: "Couldn't upload the file.",
    });
  }
}
