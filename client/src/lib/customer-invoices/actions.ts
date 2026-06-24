"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type {
  CustomerInvoice,
  CustomerInvoiceLineRow,
  CustomerInvoicePaymentMethod,
  CustomerInvoicePaymentRow,
} from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type CIResult = { ok: true; customer_invoice: CustomerInvoice } | ErrorResult;
export type CILineResult = { ok: true; line: CustomerInvoiceLineRow } | ErrorResult;
export type CIPaymentResult =
  | { ok: true; payment: CustomerInvoicePaymentRow; customer_invoice: CustomerInvoice }
  | ErrorResult;
export type CIDeleteResult = { ok: true } | ErrorResult;

export interface CustomerInvoiceInput {
  customer_id?: number;
  customer_order_id?: number | null;
  currency_code?: string;
  invoice_date?: string | null;
  due_date?: string | null;
  billing_address?: string | null;
  customer_reference?: string | null;
  free_text?: string | null;
  discount_pct?: string | null;
  tax_rate?: string | null;
}

export async function createCustomerInvoiceAction(
  input: CustomerInvoiceInput,
): Promise<CIResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createCustomerInvoiceAction");

  try {
    const res = await api<{ customer_invoice: CustomerInvoice }>(
      "/api/customer-invoices",
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath("/sales/invoices");
    return { ok: true, customer_invoice: res.customer_invoice };
  } catch (err) {
    return toErrorResult(err, {
      source: "createCustomerInvoiceAction",
      fallbackDetail: "Couldn't create the invoice.",
    });
  }
}

/** Generate a draft invoice from a confirmed CO. Auto-pulls unbilled
 *  qty per line. Server rejects if every line is already fully billed. */
export async function createInvoiceFromCOAction(
  coUuid: string,
  input: Omit<CustomerInvoiceInput, "customer_id" | "customer_order_id">,
): Promise<CIResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createInvoiceFromCOAction");

  try {
    const res = await api<{ customer_invoice: CustomerInvoice }>(
      `/api/customer-orders/${encodeURIComponent(coUuid)}/generate-invoice`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath("/sales/invoices");
    revalidatePath(`/sales/orders/${coUuid}`);
    return { ok: true, customer_invoice: res.customer_invoice };
  } catch (err) {
    return toErrorResult(err, {
      source: "createInvoiceFromCOAction",
      fallbackDetail: "Couldn't generate the invoice.",
    });
  }
}

export async function updateCustomerInvoiceAction(
  uuid: string,
  input: CustomerInvoiceInput,
): Promise<CIResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateCustomerInvoiceAction");

  try {
    const res = await api<{ customer_invoice: CustomerInvoice }>(
      `/api/customer-invoices/${encodeURIComponent(uuid)}`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath("/sales/invoices");
    revalidatePath(`/sales/invoices/${uuid}`);
    return { ok: true, customer_invoice: res.customer_invoice };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateCustomerInvoiceAction",
      fallbackDetail: "Couldn't update the invoice.",
    });
  }
}

export async function deleteCustomerInvoiceAction(
  uuid: string,
): Promise<CIDeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deleteCustomerInvoiceAction");

  try {
    await api<void>(`/api/customer-invoices/${encodeURIComponent(uuid)}`, {
      method: "DELETE",
      token,
    });
    revalidatePath("/sales/invoices");
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteCustomerInvoiceAction",
      fallbackDetail: "Couldn't delete the invoice.",
    });
  }
}

// ----- lines -----------------------------------------------------

export interface CILineInput {
  item_id?: number | null;
  customer_order_line_id?: number | null;
  description?: string | null;
  qty: string;
  unit_price: string;
  discount_pct?: string;
  delivery_date?: string | null;
  notes?: string | null;
}

export async function addCILineAction(
  invoiceUuid: string,
  input: CILineInput,
): Promise<CILineResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("addCILineAction");

  try {
    const res = await api<{ line: CustomerInvoiceLineRow }>(
      `/api/customer-invoices/${encodeURIComponent(invoiceUuid)}/lines`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/sales/invoices/${invoiceUuid}`);
    return { ok: true, line: res.line };
  } catch (err) {
    return toErrorResult(err, {
      source: "addCILineAction",
      fallbackDetail: "Couldn't add the line.",
    });
  }
}

export async function updateCILineAction(
  invoiceUuid: string,
  lineUuid: string,
  input: Partial<CILineInput>,
): Promise<CILineResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateCILineAction");

  try {
    const res = await api<{ line: CustomerInvoiceLineRow }>(
      `/api/customer-invoices/${encodeURIComponent(invoiceUuid)}/lines/${encodeURIComponent(lineUuid)}`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/sales/invoices/${invoiceUuid}`);
    return { ok: true, line: res.line };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateCILineAction",
      fallbackDetail: "Couldn't update the line.",
    });
  }
}

export async function removeCILineAction(
  invoiceUuid: string,
  lineUuid: string,
): Promise<CIDeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("removeCILineAction");

  try {
    await api<void>(
      `/api/customer-invoices/${encodeURIComponent(invoiceUuid)}/lines/${encodeURIComponent(lineUuid)}`,
      { method: "DELETE", token },
    );
    revalidatePath(`/sales/invoices/${invoiceUuid}`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "removeCILineAction",
      fallbackDetail: "Couldn't remove the line.",
    });
  }
}

// ----- state transitions + payments ------------------------------

export async function sendCustomerInvoiceAction(uuid: string): Promise<CIResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("sendCustomerInvoiceAction");

  try {
    const res = await api<{ customer_invoice: CustomerInvoice }>(
      `/api/customer-invoices/${encodeURIComponent(uuid)}/send`,
      { method: "POST", token },
    );
    revalidatePath("/sales/invoices");
    revalidatePath(`/sales/invoices/${uuid}`);
    return { ok: true, customer_invoice: res.customer_invoice };
  } catch (err) {
    return toErrorResult(err, {
      source: "sendCustomerInvoiceAction",
      fallbackDetail: "Couldn't send the invoice.",
    });
  }
}

export async function cancelCustomerInvoiceAction(
  uuid: string,
  reason: string,
): Promise<CIResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("cancelCustomerInvoiceAction");

  try {
    const res = await api<{ customer_invoice: CustomerInvoice }>(
      `/api/customer-invoices/${encodeURIComponent(uuid)}/cancel`,
      { method: "POST", token, body: JSON.stringify({ reason }) },
    );
    revalidatePath("/sales/invoices");
    revalidatePath(`/sales/invoices/${uuid}`);
    return { ok: true, customer_invoice: res.customer_invoice };
  } catch (err) {
    return toErrorResult(err, {
      source: "cancelCustomerInvoiceAction",
      fallbackDetail: "Couldn't cancel the invoice.",
    });
  }
}

export interface CIPaymentInput {
  paid_at: string;
  amount: string;
  method: CustomerInvoicePaymentMethod;
  reference?: string | null;
  notes?: string | null;
}

export async function recordCIPaymentAction(
  invoiceUuid: string,
  input: CIPaymentInput,
): Promise<CIPaymentResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("recordCIPaymentAction");

  try {
    const res = await api<{
      payment: CustomerInvoicePaymentRow;
      customer_invoice: CustomerInvoice;
    }>(
      `/api/customer-invoices/${encodeURIComponent(invoiceUuid)}/payments`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/sales/invoices/${invoiceUuid}`);
    revalidatePath("/sales/invoices");
    return {
      ok: true,
      payment: res.payment,
      customer_invoice: res.customer_invoice,
    };
  } catch (err) {
    return toErrorResult(err, {
      source: "recordCIPaymentAction",
      fallbackDetail: "Couldn't record the payment.",
    });
  }
}
