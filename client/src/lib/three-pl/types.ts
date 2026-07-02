import type { StockLot } from "../types";

/** The two exits from the customer-order wizard's post-release step. */
export type RoutingChoice = "three_pl" | "shipment";

export interface ThreePLInventoryRow {
  /** Full lot payload; carries item, placements, and the bailee_customer
   *  snapshot needed to render the tab row. */
  lot: StockLot;
  /** Stored volume in m³, rounded to 4 dp. Backend computes it from
   *  package_*_mm × qty_on_hand / units_per_package so the tab always
   *  matches the wizard's capacity math. */
  stored_volume_m3: string;
  /** Whole days since `bailee_routed_at`. Used by the 3PL tab as a
   *  quick eyeball of dwell time + as the multiplier for
   *  `accrued_amount`. */
  days_held: number;
  /** Running storage charge, decimal string, expressed in the company
   *  base currency. Null when no rate is configured (settings card
   *  empty). Rate lookup happens once per /inventory request; the
   *  per-lot value is `days_held × stored_volume_m³ × rate`. */
  accrued_amount: string | null;
}

export interface ThreePLInventoryResponse {
  /** Rate + currency active at fetch time. `amount` is null when the
   *  operator hasn't set a rate yet — the tab renders "no rate
   *  configured" instead of £0.00 rollups. */
  rate: {
    amount: string | null;
    currency: string;
  };
  items: ThreePLInventoryRow[];
}

export interface ThreePLCapacityResponse {
  warehouse_uuid: string;
  free_m3: {
    three_pl_storage: string;
    dispatch: string;
  };
}

export interface ThreePLDispatchRow {
  uuid: string;
  qty: string;
  reference: string | null;
  notes: string | null;
  photo_url: string | null;
  dispatched_at: string;
  dispatched_by: {
    id: number;
    uuid: string;
    name: string | null;
    email: string | null;
  } | null;
}

export interface DispatchLotInput {
  qty: string;
  reference?: string | null;
  notes?: string | null;
  photo_url?: string | null;
}

/** Full bundle for the /three-pl/[lot_uuid] item page. */
export interface ThreePLLotDetailResponse {
  lot: StockLot;
  summary: {
    held_volume_m3: string;
    original_qty: string | null;
    held_qty: string | null;
    dispatched_qty: string | null;
    days_held: number;
    accrued_amount: string | null;
    currency: string;
    rate: string | null;
  };
  dispatches: ThreePLDispatchRow[];
  release: ThreePLReleaseBundle | null;
}

export interface ThreePLReleaseBundle {
  uuid: string;
  status: "pending" | "released" | "on_hold" | "rejected";
  finalized_at: string | null;
  finalized_by: {
    id: number;
    uuid: string;
    name: string | null;
    email: string | null;
  } | null;
  releaser: {
    id: number;
    uuid: string;
    name: string | null;
    email: string | null;
  } | null;
  approver: {
    id: number;
    uuid: string;
    name: string | null;
    email: string | null;
  } | null;
  files: ThreePLReleaseFile[];
}

export interface ThreePLReleaseFile {
  uuid: string;
  kind: string;
  filename: string;
  mime: string;
  byte_size: number;
  uploaded_at: string;
  uploaded_by: {
    id: number;
    uuid: string;
    name: string | null;
    email: string | null;
  } | null;
}
