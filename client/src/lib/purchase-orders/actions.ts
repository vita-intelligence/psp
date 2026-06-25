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
  // D.1 financial + delivery extensions — server computes discount_amount /
  // tax_amount / grand_total from these. NEVER send computed fields.
  discount_pct?: string | null;
  tax_rate?: string | null;
  shipping_fees?: string | null;
  additional_fees?: string | null;
  default_warehouse_id?: number | null;
}

export interface POLineReservation {
  /** UUID of the MO that should get the placeholder booking. */
  mo_uuid: string;
  /** Qty (string decimal). Will be clamped server-side to the line's
   *  remaining qty and the MO's outstanding shortage. */
  qty: string;
}

export interface POLineInput {
  item_id?: number;
  qty_ordered?: string;
  unit_price?: string;
  expected_delivery_date?: string | null;
  notes?: string | null;
  /** Per-line site override; null falls back to PO `default_warehouse_id`. */
  warehouse_id?: number | null;
  vendor_part_no?: string | null;
  /** Optional explicit MO allocations. When set, the BE creates
   *  placeholder bookings exactly per spec instead of auto-FIFO.
   *  Leave undefined / empty to use the default planned_start-FIFO. */
  reservations?: POLineReservation[];
}

/** Single-transaction create. Sends the header plus the lines array;
 *  the backend opens one Repo.transaction so a bad line rolls back the
 *  PO insert too. Use this from the new single-page PO create form. */
export async function createPOWithLinesAction(
  header: POHeaderInput,
  lines: POLineInput[],
): Promise<POResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createPOWithLinesAction");
  try {
    const res = await api<{ purchase_order: PurchaseOrder }>(
      "/api/purchase-orders",
      {
        method: "POST",
        token,
        body: JSON.stringify({ ...header, lines }),
      },
    );
    revalidatePath("/procurement/purchase-orders");
    return { ok: true, po: res.purchase_order };
  } catch (err) {
    return toErrorResult(err, {
      source: "createPOWithLinesAction",
      fallbackDetail: "Couldn't create the PO with lines.",
    });
  }
}

/** Multipart upload of a supplier paperwork file (quote PDF, spec
 *  sheet, etc.). Streams via Backend.Storage; the returned `file.uuid`
 *  is how the BE references it. */
export async function uploadPOFileAction(
  poUuid: string,
  formData: FormData,
): Promise<
  | { ok: true; file: import("../types").PurchaseOrderFile }
  | ErrorResult
> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("uploadPOFileAction");
  try {
    const res = await api<{ file: import("../types").PurchaseOrderFile }>(
      `/api/purchase-orders/${encodeURIComponent(poUuid)}/files`,
      { method: "POST", token, body: formData },
    );
    revalidatePath(`/procurement/purchase-orders/${poUuid}`);
    return { ok: true, file: res.file };
  } catch (err) {
    return toErrorResult(err, {
      source: "uploadPOFileAction",
      fallbackDetail: "Couldn't upload the file.",
    });
  }
}

export async function deletePOFileAction(
  poUuid: string,
  fileUuid: string,
): Promise<DeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deletePOFileAction");
  try {
    await api<void>(
      `/api/purchase-orders/${encodeURIComponent(poUuid)}/files/${encodeURIComponent(fileUuid)}`,
      { method: "DELETE", token },
    );
    revalidatePath(`/procurement/purchase-orders/${poUuid}`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deletePOFileAction",
      fallbackDetail: "Couldn't delete the file.",
    });
  }
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

/** One pack per row in the receive dialog. Each pack becomes its own
 *  stock_lot. Packaging is per-pack (not per-line) so a single PO line
 *  arriving as "4 × 25kg drums + 1 × 100kg sack" creates 2 lots —
 *  identical drums roll up via `units_per_package=4`. */
export interface ReceivePOPack {
  qty: string;
  package_length_mm: number;
  package_width_mm: number;
  package_height_mm: number;
  package_weight_kg: string;
  units_per_package: number;
  stack_factor: number;
  /** When null the pack inherits `supplier_batch_no_default` from the
   *  top-level payload. Distinct batches are kept on distinct packs so
   *  traceability isn't lost when the supplier ships mixed batches. */
  supplier_batch_no?: string | null;
  manufactured_at?: string | null;
  expiry_at?: string | null;
  country_of_origin?: string | null;
  revision?: string | null;
  /** When true, the lifecycle service emits a `routed_to_quarantine`
   *  event right after the `received` event — for visibly-damaged
   *  packs or vendors flagged high-risk. */
  route_to_quarantine?: boolean;
}

export interface ReceivePOLine {
  line_uuid: string;
  packs: ReceivePOPack[];
}

export interface ReceivePOInput {
  warehouse_id: number;
  /** Top-level default — packs without their own batch inherit this. */
  supplier_batch_no_default?: string | null;
  lines: ReceivePOLine[];
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
