"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";
import type {
  InvoiceFormInput,
  ProcurementInvoice,
} from "./types";

export type InvoiceResult =
  | { ok: true; invoice: ProcurementInvoice }
  | ErrorResult;
export type InvoiceDeleteResult = { ok: true } | ErrorResult;

/** Invalidates the two surfaces that show an invoice — the per-PO
 *  card and the global ledger. Both are server-rendered, so the
 *  router cache needs busting. */
function revalidateInvoiceSurfaces(poUuid?: string | null) {
  revalidatePath("/procurement/invoices");
  if (poUuid)
    revalidatePath(`/procurement/purchase-orders/${poUuid}`);
}

export async function createInvoiceAction(
  poUuid: string,
  input: InvoiceFormInput,
): Promise<InvoiceResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createInvoiceAction");
  try {
    const res = await api<{ invoice: ProcurementInvoice }>(
      `/api/purchase-orders/${encodeURIComponent(poUuid)}/invoices`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidateInvoiceSurfaces(poUuid);
    return { ok: true, invoice: res.invoice };
  } catch (err) {
    return toErrorResult(err, {
      source: "createInvoiceAction",
      fallbackDetail: "Couldn't add the invoice.",
    });
  }
}

export async function updateInvoiceAction(
  invoiceUuid: string,
  input: InvoiceFormInput,
  poUuid?: string | null,
): Promise<InvoiceResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateInvoiceAction");
  try {
    const res = await api<{ invoice: ProcurementInvoice }>(
      `/api/procurement/invoices/${encodeURIComponent(invoiceUuid)}`,
      { method: "PATCH", token, body: JSON.stringify(input) },
    );
    revalidateInvoiceSurfaces(poUuid ?? res.invoice.purchase_order?.uuid);
    return { ok: true, invoice: res.invoice };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateInvoiceAction",
      fallbackDetail: "Couldn't update the invoice.",
    });
  }
}

export async function deleteInvoiceAction(
  invoiceUuid: string,
  poUuid?: string | null,
): Promise<InvoiceDeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deleteInvoiceAction");
  try {
    await api<void>(
      `/api/procurement/invoices/${encodeURIComponent(invoiceUuid)}`,
      { method: "DELETE", token },
    );
    revalidateInvoiceSurfaces(poUuid);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteInvoiceAction",
      fallbackDetail: "Couldn't delete the invoice.",
    });
  }
}

export async function markInvoicePaidAction(
  invoiceUuid: string,
  paidAmount?: string | null,
  poUuid?: string | null,
): Promise<InvoiceResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("markInvoicePaidAction");
  try {
    const res = await api<{ invoice: ProcurementInvoice }>(
      `/api/procurement/invoices/${encodeURIComponent(invoiceUuid)}/mark-paid`,
      {
        method: "POST",
        token,
        body: JSON.stringify(
          paidAmount ? { paid_amount: paidAmount } : {},
        ),
      },
    );
    revalidateInvoiceSurfaces(poUuid ?? res.invoice.purchase_order?.uuid);
    return { ok: true, invoice: res.invoice };
  } catch (err) {
    return toErrorResult(err, {
      source: "markInvoicePaidAction",
      fallbackDetail: "Couldn't mark the invoice paid.",
    });
  }
}

export async function disputeInvoiceAction(
  invoiceUuid: string,
  notes: string,
  poUuid?: string | null,
): Promise<InvoiceResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("disputeInvoiceAction");
  try {
    const res = await api<{ invoice: ProcurementInvoice }>(
      `/api/procurement/invoices/${encodeURIComponent(invoiceUuid)}/dispute`,
      { method: "POST", token, body: JSON.stringify({ notes }) },
    );
    revalidateInvoiceSurfaces(poUuid ?? res.invoice.purchase_order?.uuid);
    return { ok: true, invoice: res.invoice };
  } catch (err) {
    return toErrorResult(err, {
      source: "disputeInvoiceAction",
      fallbackDetail: "Couldn't flag the invoice as disputed.",
    });
  }
}

export async function voidInvoiceAction(
  invoiceUuid: string,
  notes?: string | null,
  poUuid?: string | null,
): Promise<InvoiceResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("voidInvoiceAction");
  try {
    const res = await api<{ invoice: ProcurementInvoice }>(
      `/api/procurement/invoices/${encodeURIComponent(invoiceUuid)}/void`,
      {
        method: "POST",
        token,
        body: JSON.stringify(notes ? { notes } : {}),
      },
    );
    revalidateInvoiceSurfaces(poUuid ?? res.invoice.purchase_order?.uuid);
    return { ok: true, invoice: res.invoice };
  } catch (err) {
    return toErrorResult(err, {
      source: "voidInvoiceAction",
      fallbackDetail: "Couldn't void the invoice.",
    });
  }
}

/** Multipart upload of the PDF / spreadsheet evidence. Mirrors the
 *  PO file upload shape — bytes go through the BE so ACL stays
 *  enforced on every download too. */
export async function attachInvoiceFileAction(
  invoiceUuid: string,
  formData: FormData,
  poUuid?: string | null,
): Promise<InvoiceResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("attachInvoiceFileAction");
  try {
    const res = await api<{ invoice: ProcurementInvoice }>(
      `/api/procurement/invoices/${encodeURIComponent(invoiceUuid)}/file`,
      { method: "POST", token, body: formData },
    );
    revalidateInvoiceSurfaces(poUuid ?? res.invoice.purchase_order?.uuid);
    return { ok: true, invoice: res.invoice };
  } catch (err) {
    return toErrorResult(err, {
      source: "attachInvoiceFileAction",
      fallbackDetail: "Couldn't upload the invoice file.",
    });
  }
}

export async function detachInvoiceFileAction(
  invoiceUuid: string,
  poUuid?: string | null,
): Promise<InvoiceResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("detachInvoiceFileAction");
  try {
    const res = await api<{ invoice: ProcurementInvoice }>(
      `/api/procurement/invoices/${encodeURIComponent(invoiceUuid)}/file`,
      { method: "DELETE", token },
    );
    revalidateInvoiceSurfaces(poUuid ?? res.invoice.purchase_order?.uuid);
    return { ok: true, invoice: res.invoice };
  } catch (err) {
    return toErrorResult(err, {
      source: "detachInvoiceFileAction",
      fallbackDetail: "Couldn't remove the invoice file.",
    });
  }
}
