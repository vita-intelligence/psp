"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type {
  CustomerInvoice,
  CustomerReturn,
  CustomerReturnFileKind,
  CustomerReturnFileRow,
  CustomerReturnLineRow,
  CustomerReturnReasonCode,
} from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type CRResult = { ok: true; customer_return: CustomerReturn } | ErrorResult;
export type CRLineResult = { ok: true; line: CustomerReturnLineRow } | ErrorResult;
export type CRFileResult = { ok: true; file: CustomerReturnFileRow } | ErrorResult;
export type CRDeleteResult = { ok: true } | ErrorResult;
export type CRAcceptResult =
  | {
      ok: true;
      customer_return: CustomerReturn;
      credit_note: CustomerInvoice | null;
    }
  | ErrorResult;

export interface CustomerReturnInput {
  customer_id?: number;
  customer_invoice_id?: number | null;
  return_date?: string | null;
  reason_summary?: string | null;
  notes?: string | null;
}

export async function createCustomerReturnAction(
  input: CustomerReturnInput,
): Promise<CRResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createCustomerReturnAction");

  try {
    const res = await api<{ customer_return: CustomerReturn }>(
      "/api/customer-returns",
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath("/sales/returns");
    return { ok: true, customer_return: res.customer_return };
  } catch (err) {
    return toErrorResult(err, {
      source: "createCustomerReturnAction",
      fallbackDetail: "Couldn't create the RMA.",
    });
  }
}

export async function updateCustomerReturnAction(
  uuid: string,
  input: CustomerReturnInput,
): Promise<CRResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateCustomerReturnAction");

  try {
    const res = await api<{ customer_return: CustomerReturn }>(
      `/api/customer-returns/${encodeURIComponent(uuid)}`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath("/sales/returns");
    revalidatePath(`/sales/returns/${uuid}`);
    return { ok: true, customer_return: res.customer_return };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateCustomerReturnAction",
      fallbackDetail: "Couldn't update the RMA.",
    });
  }
}

export async function deleteCustomerReturnAction(
  uuid: string,
): Promise<CRDeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deleteCustomerReturnAction");

  try {
    await api<void>(`/api/customer-returns/${encodeURIComponent(uuid)}`, {
      method: "DELETE",
      token,
    });
    revalidatePath("/sales/returns");
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteCustomerReturnAction",
      fallbackDetail: "Couldn't delete the RMA.",
    });
  }
}

// ----- lines -----------------------------------------------------

export interface CRLineInput {
  item_id?: number | null;
  customer_invoice_line_id?: number | null;
  qty_returned: string;
  reason_code: CustomerReturnReasonCode;
  reason_notes?: string | null;
  unit_price?: string | null;
}

export async function addCRLineAction(
  rmaUuid: string,
  input: CRLineInput,
): Promise<CRLineResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("addCRLineAction");

  try {
    const res = await api<{ line: CustomerReturnLineRow }>(
      `/api/customer-returns/${encodeURIComponent(rmaUuid)}/lines`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/sales/returns/${rmaUuid}`);
    return { ok: true, line: res.line };
  } catch (err) {
    return toErrorResult(err, {
      source: "addCRLineAction",
      fallbackDetail: "Couldn't add the line.",
    });
  }
}

export async function updateCRLineAction(
  rmaUuid: string,
  lineUuid: string,
  input: Partial<CRLineInput> & {
    qty_accepted?: string | null;
    inspection_notes?: string | null;
  },
): Promise<CRLineResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateCRLineAction");

  try {
    const res = await api<{ line: CustomerReturnLineRow }>(
      `/api/customer-returns/${encodeURIComponent(rmaUuid)}/lines/${encodeURIComponent(lineUuid)}`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/sales/returns/${rmaUuid}`);
    return { ok: true, line: res.line };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateCRLineAction",
      fallbackDetail: "Couldn't update the line.",
    });
  }
}

export async function removeCRLineAction(
  rmaUuid: string,
  lineUuid: string,
): Promise<CRDeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("removeCRLineAction");

  try {
    await api<void>(
      `/api/customer-returns/${encodeURIComponent(rmaUuid)}/lines/${encodeURIComponent(lineUuid)}`,
      { method: "DELETE", token },
    );
    revalidatePath(`/sales/returns/${rmaUuid}`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "removeCRLineAction",
      fallbackDetail: "Couldn't remove the line.",
    });
  }
}

// ----- state transitions ----------------------------------------

export async function markRMAReceivedAction(
  uuid: string,
): Promise<CRResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("markRMAReceivedAction");

  try {
    const res = await api<{ customer_return: CustomerReturn }>(
      `/api/customer-returns/${encodeURIComponent(uuid)}/mark-received`,
      { method: "POST", token },
    );
    revalidatePath("/sales/returns");
    revalidatePath(`/sales/returns/${uuid}`);
    return { ok: true, customer_return: res.customer_return };
  } catch (err) {
    return toErrorResult(err, {
      source: "markRMAReceivedAction",
      fallbackDetail: "Couldn't mark the RMA received.",
    });
  }
}

export interface CRAcceptInput {
  /** Per-line decisions: `{ "<line_uuid>": { qty_accepted, inspection_notes? } }` */
  line_decisions?: Record<
    string,
    { qty_accepted: string; inspection_notes?: string | null }
  >;
  issue_credit_note?: boolean;
}

export async function acceptRMAAction(
  uuid: string,
  input: CRAcceptInput,
): Promise<CRAcceptResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("acceptRMAAction");

  try {
    const res = await api<{
      customer_return: CustomerReturn;
      credit_note: CustomerInvoice | null;
    }>(
      `/api/customer-returns/${encodeURIComponent(uuid)}/accept`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath("/sales/returns");
    revalidatePath(`/sales/returns/${uuid}`);
    if (res.credit_note) revalidatePath("/sales/invoices");
    return {
      ok: true,
      customer_return: res.customer_return,
      credit_note: res.credit_note,
    };
  } catch (err) {
    return toErrorResult(err, {
      source: "acceptRMAAction",
      fallbackDetail: "Couldn't accept the RMA.",
    });
  }
}

export async function rejectRMAAction(
  uuid: string,
  reason: string,
): Promise<CRResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("rejectRMAAction");

  try {
    const res = await api<{ customer_return: CustomerReturn }>(
      `/api/customer-returns/${encodeURIComponent(uuid)}/reject`,
      { method: "POST", token, body: JSON.stringify({ reason }) },
    );
    revalidatePath("/sales/returns");
    revalidatePath(`/sales/returns/${uuid}`);
    return { ok: true, customer_return: res.customer_return };
  } catch (err) {
    return toErrorResult(err, {
      source: "rejectRMAAction",
      fallbackDetail: "Couldn't reject the RMA.",
    });
  }
}

export async function cancelRMAAction(
  uuid: string,
  reason: string,
): Promise<CRResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("cancelRMAAction");

  try {
    const res = await api<{ customer_return: CustomerReturn }>(
      `/api/customer-returns/${encodeURIComponent(uuid)}/cancel`,
      { method: "POST", token, body: JSON.stringify({ reason }) },
    );
    revalidatePath("/sales/returns");
    revalidatePath(`/sales/returns/${uuid}`);
    return { ok: true, customer_return: res.customer_return };
  } catch (err) {
    return toErrorResult(err, {
      source: "cancelRMAAction",
      fallbackDetail: "Couldn't cancel the RMA.",
    });
  }
}

// ----- file evidence --------------------------------------------

export async function uploadRMAFileAction(
  rmaUuid: string,
  file: File,
  kind: CustomerReturnFileKind = "photo",
): Promise<CRFileResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("uploadRMAFileAction");

  try {
    const formData = new FormData();
    formData.set("file", file, file.name);
    formData.set("kind", kind);

    const res = await api<{ file: CustomerReturnFileRow }>(
      `/api/customer-returns/${encodeURIComponent(rmaUuid)}/files`,
      { method: "POST", token, body: formData },
    );
    revalidatePath(`/sales/returns/${rmaUuid}`);
    return { ok: true, file: res.file };
  } catch (err) {
    return toErrorResult(err, {
      source: "uploadRMAFileAction",
      fallbackDetail: "Couldn't upload the file.",
    });
  }
}

export async function removeRMAFileAction(
  rmaUuid: string,
  fileUuid: string,
): Promise<CRDeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("removeRMAFileAction");

  try {
    await api<void>(
      `/api/customer-returns/${encodeURIComponent(rmaUuid)}/files/${encodeURIComponent(fileUuid)}`,
      { method: "DELETE", token },
    );
    revalidatePath(`/sales/returns/${rmaUuid}`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "removeRMAFileAction",
      fallbackDetail: "Couldn't remove the file.",
    });
  }
}
