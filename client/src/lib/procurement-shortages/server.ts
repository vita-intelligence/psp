import "server-only";

import { api } from "../api";
import { getSessionToken } from "../auth/server";

export interface ShortageDependentMo {
  uuid: string;
  /** Rendered MO code (e.g. "MO00016") — display this, not the UUID. */
  code: string | null;
  status: string;
  quantity: string;
  item_name: string;
  planned_start: string | null;
  /** NPD formulation uuid resolved via the root MO's customer order.
   *  Stable project identity — same uuid the CFF formulation page
   *  uses. Null when this MO (or its root) has no customer order
   *  attached (trial batch without a payment, legacy MO). */
  formulation_uuid: string | null;
  /** Human label for the project (customer order line's finished-
   *  product name). Falls back to null when there's no CO line. */
  formulation_name: string | null;
}

/** A vendor that CAN ship this item today. Ranked list is returned
 *  sorted strongest-signal-first — ``source === "purchase_term"``
 *  rows (ordered by their ``priority``) always precede ``"approved"``
 *  rows. The first entry is the "primary vendor" we badge on the row.
 *
 *  See ``Backend.Procurement.Shortages.compute_vendor_candidates/2``.
 */
export interface ShortageVendorCandidate {
  vendor_id: number;
  vendor_uuid: string;
  vendor_name: string;
  /** Which table surfaced this candidate.
   *   * ``purchase_term`` — explicit commercial baseline (strongest).
   *   * ``approved`` — supplier approved to ship but no term yet. */
  source: "purchase_term" | "approved";
  /** Term priority (1 = primary vendor). Approved-only rows get a
   *  sentinel ``9999`` so they sort below every term. */
  priority: number;
  lead_time_days: number | null;
  /** Term unit price. Null on approved-only rows. */
  price: string | null;
  currency_code: string | null;
  vendor_part_no: string | null;
  min_quantity: string | null;
  /** Last-paid price per vendor_item_prices. Null when no PO has
   *  landed on this (item, vendor) pair yet. */
  last_paid_price: string | null;
  last_paid_currency: string | null;
  last_paid_at: string | null;
}

export interface ShortageRow {
  item: {
    id: number;
    uuid: string;
    name: string;
    item_type: string;
    stock_uom: { id: number; symbol: string; name: string } | null;
  } | null;
  /** R&D stream flag. When true, this row aggregates demand only
   *  from trial / sample MOs; when false, from production MOs. A
   *  single item can appear as two rows (one per stream) — pushing
   *  the buyer to create separate POs so the ``For R&D`` flag is
   *  set correctly and the booking guard on trial MOs stays happy. */
  is_rnd: boolean;
  /** The UoM every contributing BOM line for this row actually
   *  stores its qty in (kg / L after the NPD base-unit normaliser).
   *  Prefer this over ``item.stock_uom`` when rendering the row's
   *  numbers so the label matches the value. Null on legacy rows
   *  where no BOM line has a UoM set. */
  line_uom: { id: number; symbol: string; name: string } | null;
  required_qty: string;
  booked_qty: string;
  expecting_qty: string;
  shortage_qty: string;
  on_hand_qty: string;
  /** True when at least one contributing MO explicitly hit
   *  "Request purchases". Rows with ``shortage_qty === "0"`` but
   *  ``explicit_request === true`` are here because an operator
   *  flagged them, not because the company is genuinely short —
   *  the FE badges these differently so procurement knows to
   *  "book from stock" rather than raise a fresh PO. */
  explicit_request: boolean;
  dependent_mos: ShortageDependentMo[];
  /** Ranked vendor candidates — see :class:`ShortageVendorCandidate`.
   *  Empty when the item has no purchase terms + no approved
   *  vendors (orphan — buyer picks manually). */
  vendor_candidates: ShortageVendorCandidate[];
}

export interface ShortagesResponse {
  items: ShortageRow[];
  next_cursor: string | null;
}

export interface ShortageProject {
  /** NPD formulation uuid — stable key the FE filters on. */
  formulation_uuid: string;
  /** Human label (customer-order-line's finished-product name). */
  formulation_name: string | null;
}

export interface ShortageProjectsResponse {
  projects: ShortageProject[];
}

export async function getProcurementShortages(): Promise<ShortagesResponse | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    return await api<ShortagesResponse>(
      "/api/procurement/shortages?limit=50&sort=shortage_qty:desc",
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

export async function getShortageProjects(): Promise<ShortageProjectsResponse | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    return await api<ShortageProjectsResponse>(
      "/api/procurement/shortages/projects",
      { token, cache: "no-store" },
    );
  } catch {
    return null;
  }
}
