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
   *  quick eyeball of dwell time; the exact accrual will be computed
   *  from the rate + this timestamp in Phase 2. */
  days_held: number;
}

export interface ThreePLInventoryResponse {
  items: ThreePLInventoryRow[];
}

export interface ThreePLCapacityResponse {
  warehouse_uuid: string;
  free_m3: {
    three_pl_storage: string;
    dispatch: string;
  };
}
