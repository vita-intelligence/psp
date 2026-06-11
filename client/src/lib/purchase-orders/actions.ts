"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type {
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderSuggestPrice,
} from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type POResult = { ok: true; po: PurchaseOrder } | ErrorResult;
export type LineResult = { ok: true; line: PurchaseOrderLine } | ErrorResult;
export type DeleteResult = { ok: true } | ErrorResult;
export type SuggestPriceResult =
  | { ok: true; last_paid: PurchaseOrderSuggestPrice["last_paid"] }
  | ErrorResult;

export interface POHeaderInput {
  vendor_id?: number;
  currency_code?: string;
  expected_delivery_date?: string | null;
  delivery_address?: string | null;
  notes?: string | null;
}

export interface POLineInput {
  item_id?: number;
  qty_ordered?: string;
  unit_price?: string;
  expected_delivery_date?: string | null;
  notes?: string | null;
}

export async function createPOAction(input: POHeaderInput): Promise<POResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createPOAction");
  try {
    const res = await api<{ purchase_order: PurchaseOrder }>(
      "/api/purchase-orders",
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath("/procurement/purchase-orders");
    return { ok: true, po: res.purchase_order };
  } catch (err) {
    return toErrorResult(err, {
      source: "createPOAction",
      fallbackDetail: "Couldn't create the PO.",
    });
  }
}

export async function updatePOAction(
  uuid: string,
  input: POHeaderInput,
): Promise<POResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updatePOAction");
  try {
    const res = await api<{ purchase_order: PurchaseOrder }>(
      `/api/purchase-orders/${encodeURIComponent(uuid)}`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath("/procurement/purchase-orders");
    revalidatePath(`/procurement/purchase-orders/${uuid}`);
    return { ok: true, po: res.purchase_order };
  } catch (err) {
    return toErrorResult(err, {
      source: "updatePOAction",
      fallbackDetail: "Couldn't update the PO.",
    });
  }
}

export async function deletePOAction(uuid: string): Promise<DeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deletePOAction");
  try {
    await api<void>(`/api/purchase-orders/${encodeURIComponent(uuid)}`, {
      method: "DELETE",
      token,
    });
    revalidatePath("/procurement/purchase-orders");
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deletePOAction",
      fallbackDetail: "Couldn't delete the PO.",
    });
  }
}

export async function addLineAction(
  poUuid: string,
  input: POLineInput,
): Promise<LineResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("addLineAction");
  try {
    const res = await api<{ line: PurchaseOrderLine }>(
      `/api/purchase-orders/${encodeURIComponent(poUuid)}/lines`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/procurement/purchase-orders/${poUuid}`);
    return { ok: true, line: res.line };
  } catch (err) {
    return toErrorResult(err, {
      source: "addLineAction",
      fallbackDetail: "Couldn't add the line.",
    });
  }
}

export async function updateLineAction(
  poUuid: string,
  lineUuid: string,
  input: POLineInput,
): Promise<LineResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateLineAction");
  try {
    const res = await api<{ line: PurchaseOrderLine }>(
      `/api/purchase-orders/${encodeURIComponent(poUuid)}/lines/${encodeURIComponent(lineUuid)}`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/procurement/purchase-orders/${poUuid}`);
    return { ok: true, line: res.line };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateLineAction",
      fallbackDetail: "Couldn't update the line.",
    });
  }
}

/**
 * Last-paid lookup for the add-line dialog. Fired the moment the
 * worker picks an item so unit_price can pre-fill from history.
 *
 * Compliance rule: "if it can be computed, don't ask". Workers
 * shouldn't be typing prices the system already knows.
 */
export async function suggestLinePriceAction(
  poUuid: string,
  itemId: number,
): Promise<SuggestPriceResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("suggestLinePriceAction");
  try {
    const res = await api<PurchaseOrderSuggestPrice>(
      `/api/purchase-orders/${encodeURIComponent(poUuid)}/lines/suggest-price?item_id=${encodeURIComponent(String(itemId))}`,
      { token },
    );
    return { ok: true, last_paid: res.last_paid };
  } catch (err) {
    return toErrorResult(err, {
      source: "suggestLinePriceAction",
      fallbackDetail: "Couldn't load the last-paid price.",
    });
  }
}

export async function deleteLineAction(
  poUuid: string,
  lineUuid: string,
): Promise<DeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deleteLineAction");
  try {
    await api<void>(
      `/api/purchase-orders/${encodeURIComponent(poUuid)}/lines/${encodeURIComponent(lineUuid)}`,
      { method: "DELETE", token },
    );
    revalidatePath(`/procurement/purchase-orders/${poUuid}`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteLineAction",
      fallbackDetail: "Couldn't remove the line.",
    });
  }
}

async function transitionAction(
  poUuid: string,
  action: string,
  body: object = {},
  source = `transition:${action}`,
): Promise<POResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult(source);
  try {
    const res = await api<{ purchase_order: PurchaseOrder }>(
      `/api/purchase-orders/${encodeURIComponent(poUuid)}/${action}`,
      { method: "POST", token, body: JSON.stringify(body) },
    );
    revalidatePath("/procurement/purchase-orders");
    revalidatePath(`/procurement/purchase-orders/${poUuid}`);
    return { ok: true, po: res.purchase_order };
  } catch (err) {
    return toErrorResult(err, {
      source,
      fallbackDetail: "Couldn't update the PO.",
    });
  }
}

export const submitPOAction = async (uuid: string) =>
  transitionAction(uuid, "submit", {}, "submitPOAction");

export const signApproverAction = async (uuid: string, notes?: string | null) =>
  transitionAction(
    uuid,
    "approve",
    { notes: notes ?? null },
    "signApproverAction",
  );

export const signDirectorAction = async (uuid: string, notes?: string | null) =>
  transitionAction(
    uuid,
    "director-approve",
    { notes: notes ?? null },
    "signDirectorAction",
  );

export const markOrderedAction = async (uuid: string) =>
  transitionAction(uuid, "mark-ordered", {}, "markOrderedAction");

export const cancelPOAction = async (uuid: string, reason: string) =>
  transitionAction(uuid, "cancel", { reason }, "cancelPOAction");

export interface ReceiveLineInput {
  line_uuid: string;
  qty: string;
}

export interface ReceivePOInput {
  warehouse_id: number;
  supplier_batch_no?: string | null;
  package_length_mm: number;
  package_width_mm: number;
  package_height_mm: number;
  package_weight_kg: string;
  units_per_package: number;
  stack_factor: number;
  lines: ReceiveLineInput[];
}

export async function receivePOAction(
  uuid: string,
  input: ReceivePOInput,
): Promise<POResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("receivePOAction");
  try {
    const res = await api<{ purchase_order: PurchaseOrder }>(
      `/api/purchase-orders/${encodeURIComponent(uuid)}/receive`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath("/procurement/purchase-orders");
    revalidatePath(`/procurement/purchase-orders/${uuid}`);
    revalidatePath("/stock/lots");
    return { ok: true, po: res.purchase_order };
  } catch (err) {
    return toErrorResult(err, {
      source: "receivePOAction",
      fallbackDetail: "Couldn't record the receipt.",
    });
  }
}
