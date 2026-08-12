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
}

export interface ShortagesResponse {
  items: ShortageRow[];
  next_cursor: string | null;
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
