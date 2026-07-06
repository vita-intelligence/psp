"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type {
  CustomerOrder,
  CustomerOrderLine,
  CustomerApprovedItemRow,
  PriceSuggestion,
} from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type COResult = { ok: true; customer_order: CustomerOrder } | ErrorResult;
export type COLineResult = { ok: true; line: CustomerOrderLine } | ErrorResult;
export type ApprovedItemResult =
  | { ok: true; approved_item: CustomerApprovedItemRow }
  | ErrorResult;
export type CODeleteResult = { ok: true } | ErrorResult;

export interface CustomerOrderInput {
  customer_id?: number;
  currency_code?: string;
  default_warehouse_id?: number | null;
  expected_ship_date?: string | null;
  due_date?: string | null;
  delivery_address?: string | null;
  customer_reference?: string | null;
  notes?: string | null;
  discount_pct?: string | null;
  tax_rate?: string | null;
  shipping_fees?: string | null;
  additional_fees?: string | null;
}

export async function createCustomerOrderAction(
  input: CustomerOrderInput,
): Promise<COResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createCustomerOrderAction");

  try {
    const res = await api<{ customer_order: CustomerOrder }>(
      "/api/customer-orders",
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath("/sales/orders");
    return { ok: true, customer_order: res.customer_order };
  } catch (err) {
    return toErrorResult(err, {
      source: "createCustomerOrderAction",
      fallbackDetail: "Couldn't create the customer order.",
    });
  }
}

export async function updateCustomerOrderAction(
  uuid: string,
  input: CustomerOrderInput,
): Promise<COResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateCustomerOrderAction");

  try {
    const res = await api<{ customer_order: CustomerOrder }>(
      `/api/customer-orders/${encodeURIComponent(uuid)}`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath("/sales/orders");
    revalidatePath(`/sales/orders/${uuid}`);
    return { ok: true, customer_order: res.customer_order };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateCustomerOrderAction",
      fallbackDetail: "Couldn't update the customer order.",
    });
  }
}

export async function deleteCustomerOrderAction(uuid: string): Promise<CODeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deleteCustomerOrderAction");

  try {
    await api<void>(`/api/customer-orders/${encodeURIComponent(uuid)}`, {
      method: "DELETE",
      token,
    });
    revalidatePath("/sales/orders");
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteCustomerOrderAction",
      fallbackDetail: "Couldn't delete the customer order.",
    });
  }
}

// ----- lines -----------------------------------------------------

export interface COLineInput {
  item_id: number;
  qty_ordered: string;
  unit_price: string;
  discount_pct?: string;
  warehouse_id?: number | null;
  pricelist_id?: number | null;
  expected_ship_date?: string | null;
  customer_part_no?: string | null;
  notes?: string | null;
}

export async function addCOLineAction(
  coUuid: string,
  input: COLineInput,
): Promise<COLineResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("addCOLineAction");

  try {
    const res = await api<{ line: CustomerOrderLine }>(
      `/api/customer-orders/${encodeURIComponent(coUuid)}/lines`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/sales/orders/${coUuid}`);
    return { ok: true, line: res.line };
  } catch (err) {
    return toErrorResult(err, {
      source: "addCOLineAction",
      fallbackDetail: "Couldn't add the line.",
    });
  }
}

export async function updateCOLineAction(
  coUuid: string,
  lineUuid: string,
  input: Partial<COLineInput>,
): Promise<COLineResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateCOLineAction");

  try {
    const res = await api<{ line: CustomerOrderLine }>(
      `/api/customer-orders/${encodeURIComponent(coUuid)}/lines/${encodeURIComponent(lineUuid)}`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/sales/orders/${coUuid}`);
    return { ok: true, line: res.line };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateCOLineAction",
      fallbackDetail: "Couldn't update the line.",
    });
  }
}

export async function removeCOLineAction(
  coUuid: string,
  lineUuid: string,
): Promise<CODeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("removeCOLineAction");

  try {
    await api<void>(
      `/api/customer-orders/${encodeURIComponent(coUuid)}/lines/${encodeURIComponent(lineUuid)}`,
      { method: "DELETE", token },
    );
    revalidatePath(`/sales/orders/${coUuid}`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "removeCOLineAction",
      fallbackDetail: "Couldn't remove the line.",
    });
  }
}

/** Server-side pricelist lookup for the new-line auto-price. */
export async function suggestLinePriceAction(
  coUuid: string,
  itemId: number,
  qty: string,
): Promise<{ ok: true; suggestion: PriceSuggestion | null } | ErrorResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("suggestLinePriceAction");

  try {
    const params = new URLSearchParams({ item_id: String(itemId), qty });
    const res = await api<{ suggestion: PriceSuggestion | null }>(
      `/api/customer-orders/${encodeURIComponent(coUuid)}/lines/suggest-price?${params.toString()}`,
      { token, cache: "no-store" },
    );
    return { ok: true, suggestion: res.suggestion };
  } catch (err) {
    return toErrorResult(err, {
      source: "suggestLinePriceAction",
      fallbackDetail: "Couldn't look up the price.",
    });
  }
}

// ----- state transitions -----------------------------------------

export async function submitCOAction(uuid: string): Promise<COResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("submitCOAction");

  try {
    const res = await api<{ customer_order: CustomerOrder }>(
      `/api/customer-orders/${encodeURIComponent(uuid)}/submit`,
      { method: "POST", token },
    );
    revalidatePath("/sales/orders");
    revalidatePath(`/sales/orders/${uuid}`);
    return { ok: true, customer_order: res.customer_order };
  } catch (err) {
    return toErrorResult(err, {
      source: "submitCOAction",
      fallbackDetail: "Couldn't submit the order.",
    });
  }
}

export async function signApproverCOAction(
  uuid: string,
  notes?: string | null,
): Promise<COResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("signApproverCOAction");

  try {
    const res = await api<{ customer_order: CustomerOrder }>(
      `/api/customer-orders/${encodeURIComponent(uuid)}/approve`,
      {
        method: "POST",
        token,
        body: JSON.stringify({ notes: notes ?? null }),
      },
    );
    revalidatePath("/sales/orders");
    revalidatePath(`/sales/orders/${uuid}`);
    return { ok: true, customer_order: res.customer_order };
  } catch (err) {
    return toErrorResult(err, {
      source: "signApproverCOAction",
      fallbackDetail: "Couldn't sign as approver.",
    });
  }
}

export async function signDirectorCOAction(
  uuid: string,
  notes?: string | null,
): Promise<COResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("signDirectorCOAction");

  try {
    const res = await api<{ customer_order: CustomerOrder }>(
      `/api/customer-orders/${encodeURIComponent(uuid)}/director-approve`,
      {
        method: "POST",
        token,
        body: JSON.stringify({ notes: notes ?? null }),
      },
    );
    revalidatePath("/sales/orders");
    revalidatePath(`/sales/orders/${uuid}`);
    return { ok: true, customer_order: res.customer_order };
  } catch (err) {
    return toErrorResult(err, {
      source: "signDirectorCOAction",
      fallbackDetail: "Couldn't sign as director.",
    });
  }
}

export async function markConfirmedCOAction(uuid: string): Promise<COResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("markConfirmedCOAction");

  try {
    const res = await api<{ customer_order: CustomerOrder }>(
      `/api/customer-orders/${encodeURIComponent(uuid)}/mark-confirmed`,
      { method: "POST", token },
    );
    revalidatePath("/sales/orders");
    revalidatePath(`/sales/orders/${uuid}`);
    return { ok: true, customer_order: res.customer_order };
  } catch (err) {
    return toErrorResult(err, {
      source: "markConfirmedCOAction",
      fallbackDetail: "Couldn't mark confirmed.",
    });
  }
}

export async function cancelCOAction(
  uuid: string,
  reason: string,
): Promise<COResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("cancelCOAction");

  try {
    const res = await api<{ customer_order: CustomerOrder }>(
      `/api/customer-orders/${encodeURIComponent(uuid)}/cancel`,
      { method: "POST", token, body: JSON.stringify({ reason }) },
    );
    revalidatePath("/sales/orders");
    revalidatePath(`/sales/orders/${uuid}`);
    return { ok: true, customer_order: res.customer_order };
  } catch (err) {
    return toErrorResult(err, {
      source: "cancelCOAction",
      fallbackDetail: "Couldn't cancel the order.",
    });
  }
}

// ----- per-customer approved items -------------------------------

export async function addCustomerApprovedItemAction(
  customerUuid: string,
  itemId: number,
  notes?: string | null,
): Promise<ApprovedItemResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("addCustomerApprovedItemAction");

  try {
    const res = await api<{ approved_item: CustomerApprovedItemRow }>(
      `/api/customers/${encodeURIComponent(customerUuid)}/approved-items`,
      {
        method: "POST",
        token,
        body: JSON.stringify({ item_id: itemId, notes: notes ?? null }),
      },
    );
    revalidatePath(`/sales/customers/${customerUuid}`);
    return { ok: true, approved_item: res.approved_item };
  } catch (err) {
    return toErrorResult(err, {
      source: "addCustomerApprovedItemAction",
      fallbackDetail: "Couldn't add the item to the approved list.",
    });
  }
}

export async function removeCustomerApprovedItemAction(
  customerUuid: string,
  rowUuid: string,
): Promise<CODeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("removeCustomerApprovedItemAction");

  try {
    await api<void>(
      `/api/customers/${encodeURIComponent(customerUuid)}/approved-items/${encodeURIComponent(rowUuid)}`,
      { method: "DELETE", token },
    );
    revalidatePath(`/sales/customers/${customerUuid}`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "removeCustomerApprovedItemAction",
      fallbackDetail: "Couldn't remove the approved item.",
    });
  }
}
