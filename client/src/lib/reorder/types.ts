import type { Item, VendorSummary } from "../types";

/** One item that needs reordering — coverage has fallen below the
 *  configured min_stock_qty. Returned by
 *  `GET /api/procurement/reorder-suggestions`. */
export interface ReorderSuggestion {
  item: Item;
  /** Sum of qty across all `available` lot placements for this item. */
  on_hand: string;
  /** Sum of `qty_ordered − qty_received` on PO lines whose PO is in
   *  a "coming" state (draft / pending / approved / ordered /
   *  partially_received). */
  in_flight: string;
  /** on_hand + in_flight — what we can count on. */
  coverage: string;
  min_stock_qty: string;
  target_stock_qty: string;
  /** target_stock_qty − coverage, clamped at 0. */
  shortfall: string;
  /** Most recent vendor for this item — nil when the item has never
   *  been ordered. */
  suggested_vendor: VendorSummary | null;
}
