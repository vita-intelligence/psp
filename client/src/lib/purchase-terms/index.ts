"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { getSessionToken } from "@/lib/auth/server";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "@/lib/errors/server";
import type { VendorPurchaseTerm } from "@/lib/types";

type DeleteResult = { ok: true } | ErrorResult;

/**
 * Vendor detail page — every purchase term this vendor holds. Item
 * summary preloaded so the FE can group / link without a second
 * round-trip. Empty array on any soft failure so the card renders a
 * stable empty state.
 */
export async function listVendorPurchaseTerms(
  vendorUuid: string,
): Promise<VendorPurchaseTerm[]> {
  const token = await getSessionToken();
  if (!token) return [];

  try {
    const res = await api<{ purchase_terms: VendorPurchaseTerm[] }>(
      `/api/vendors/${encodeURIComponent(vendorUuid)}/purchase-terms`,
      { token, cache: "no-store" },
    );
    return res.purchase_terms;
  } catch {
    return [];
  }
}

/**
 * Item detail page — every vendor quoting this item, ranked by
 * priority ascending (1 = primary). Vendor summary preloaded.
 */
export async function listItemPurchaseTerms(
  itemUuid: string,
): Promise<VendorPurchaseTerm[]> {
  const token = await getSessionToken();
  if (!token) return [];

  try {
    const res = await api<{ purchase_terms: VendorPurchaseTerm[] }>(
      `/api/items/${encodeURIComponent(itemUuid)}/purchase-terms`,
      { token, cache: "no-store" },
    );
    return res.purchase_terms;
  } catch {
    return [];
  }
}

export interface PurchaseTermInput {
  item_id?: number;
  vendor_part_no?: string | null;
  lead_time_days?: number | null;
  price: string;
  currency_code: string;
  min_quantity?: string | null;
  min_quantity_uom?: string | null;
  priority?: number;
  valid_from?: string | null;
  valid_until?: string | null;
  notes?: string | null;
}

export type PurchaseTermResult =
  | { ok: true; purchase_term: VendorPurchaseTerm }
  | { ok: false; detail: string };

/**
 * Create a purchase term for a (vendor, item) pair. BE upserts on the
 * unique index — a second call with the same key updates the row.
 *
 * The BE refuses with `requires_approval` when the vendor isn't on
 * the item's approved-supplier list. The buyer must approve first
 * from the vendor's approved-items card; this action bubbles the
 * error detail back so the caller can render an actionable toast.
 */
export async function savePurchaseTermAction(
  vendorUuid: string,
  input: PurchaseTermInput,
  existingTermUuid?: string | null,
): Promise<PurchaseTermResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("savePurchaseTermAction");

  try {
    const path = existingTermUuid
      ? `/api/vendors/${encodeURIComponent(vendorUuid)}/purchase-terms/${encodeURIComponent(existingTermUuid)}`
      : `/api/vendors/${encodeURIComponent(vendorUuid)}/purchase-terms`;
    const method = existingTermUuid ? "PUT" : "POST";

    const res = await api<{ purchase_term: VendorPurchaseTerm }>(path, {
      method,
      token,
      body: JSON.stringify(input),
    });
    revalidatePath(`/procurement/vendors/${vendorUuid}`);
    if (res.purchase_term.item?.uuid) {
      revalidatePath(`/production/items/${res.purchase_term.item.uuid}`);
    }
    return { ok: true, purchase_term: res.purchase_term };
  } catch (err) {
    return toErrorResult(err, {
      source: "savePurchaseTermAction",
      fallbackDetail: "Couldn't save the purchase term.",
    });
  }
}

export async function deletePurchaseTermAction(
  vendorUuid: string,
  termUuid: string,
  itemUuid?: string | null,
): Promise<DeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deletePurchaseTermAction");

  try {
    await api<void>(
      `/api/vendors/${encodeURIComponent(vendorUuid)}/purchase-terms/${encodeURIComponent(termUuid)}`,
      { method: "DELETE", token },
    );
    revalidatePath(`/procurement/vendors/${vendorUuid}`);
    if (itemUuid) {
      revalidatePath(`/production/items/${itemUuid}`);
    }
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deletePurchaseTermAction",
      fallbackDetail: "Couldn't delete the purchase term.",
    });
  }
}
