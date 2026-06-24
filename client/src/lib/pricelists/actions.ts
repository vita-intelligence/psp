"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { Pricelist, PricelistItemRow } from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type PricelistResult = { ok: true; pricelist: Pricelist } | ErrorResult;
export type PricelistItemResult =
  | { ok: true; item: PricelistItemRow }
  | ErrorResult;
export type PricelistDeleteResult = { ok: true } | ErrorResult;

export interface PricelistInput {
  name?: string;
  currency_code?: string;
  is_active?: boolean;
  valid_from?: string | null;
  valid_until?: string | null;
  notes?: string | null;
}

export async function createPricelistAction(
  input: PricelistInput,
): Promise<PricelistResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createPricelistAction");

  try {
    const res = await api<{ pricelist: Pricelist }>("/api/pricelists", {
      method: "POST",
      token,
      body: JSON.stringify(input),
    });
    revalidatePath("/sales/pricelists");
    return { ok: true, pricelist: res.pricelist };
  } catch (err) {
    return toErrorResult(err, {
      source: "createPricelistAction",
      fallbackDetail: "Couldn't create the pricelist.",
    });
  }
}

export async function updatePricelistAction(
  uuid: string,
  input: PricelistInput,
): Promise<PricelistResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updatePricelistAction");

  try {
    const res = await api<{ pricelist: Pricelist }>(
      `/api/pricelists/${encodeURIComponent(uuid)}`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath("/sales/pricelists");
    revalidatePath(`/sales/pricelists/${uuid}`);
    return { ok: true, pricelist: res.pricelist };
  } catch (err) {
    return toErrorResult(err, {
      source: "updatePricelistAction",
      fallbackDetail: "Couldn't update the pricelist.",
    });
  }
}

export async function deletePricelistAction(
  uuid: string,
): Promise<PricelistDeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deletePricelistAction");

  try {
    await api<void>(`/api/pricelists/${encodeURIComponent(uuid)}`, {
      method: "DELETE",
      token,
    });
    revalidatePath("/sales/pricelists");
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deletePricelistAction",
      fallbackDetail: "Couldn't delete the pricelist.",
    });
  }
}

/** Flip the company-wide default. Backend wraps in a tx so the
 *  partial unique index never sees two defaults. */
export async function setDefaultPricelistAction(
  uuid: string,
): Promise<PricelistResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("setDefaultPricelistAction");

  try {
    const res = await api<{ pricelist: Pricelist }>(
      `/api/pricelists/${encodeURIComponent(uuid)}/set-default`,
      { method: "POST", token },
    );
    revalidatePath("/sales/pricelists");
    revalidatePath(`/sales/pricelists/${uuid}`);
    return { ok: true, pricelist: res.pricelist };
  } catch (err) {
    return toErrorResult(err, {
      source: "setDefaultPricelistAction",
      fallbackDetail: "Couldn't set the default pricelist.",
    });
  }
}

// ----- line items -----------------------------------------------

export interface PricelistLineInput {
  item_id: number;
  selling_price: string;
  min_quantity?: string;
  notes?: string | null;
}

export async function addPricelistLineAction(
  pricelistUuid: string,
  input: PricelistLineInput,
): Promise<PricelistItemResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("addPricelistLineAction");

  try {
    const res = await api<{ item: PricelistItemRow }>(
      `/api/pricelists/${encodeURIComponent(pricelistUuid)}/lines`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/sales/pricelists/${pricelistUuid}`);
    return { ok: true, item: res.item };
  } catch (err) {
    return toErrorResult(err, {
      source: "addPricelistLineAction",
      fallbackDetail: "Couldn't add the line.",
    });
  }
}

export async function updatePricelistLineAction(
  pricelistUuid: string,
  lineUuid: string,
  input: Partial<PricelistLineInput>,
): Promise<PricelistItemResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updatePricelistLineAction");

  try {
    const res = await api<{ item: PricelistItemRow }>(
      `/api/pricelists/${encodeURIComponent(pricelistUuid)}/lines/${encodeURIComponent(lineUuid)}`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/sales/pricelists/${pricelistUuid}`);
    return { ok: true, item: res.item };
  } catch (err) {
    return toErrorResult(err, {
      source: "updatePricelistLineAction",
      fallbackDetail: "Couldn't update the line.",
    });
  }
}

export async function removePricelistLineAction(
  pricelistUuid: string,
  lineUuid: string,
): Promise<PricelistDeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("removePricelistLineAction");

  try {
    await api<void>(
      `/api/pricelists/${encodeURIComponent(pricelistUuid)}/lines/${encodeURIComponent(lineUuid)}`,
      { method: "DELETE", token },
    );
    revalidatePath(`/sales/pricelists/${pricelistUuid}`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "removePricelistLineAction",
      fallbackDetail: "Couldn't remove the line.",
    });
  }
}
