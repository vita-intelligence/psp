// Final Product Release (BRCGS Issue 9 § 5.6 Positive Release) —
// TS mirror of the BE payloads in `payloads.ex`.

export type FinalReleaseStatus =
  | "pending"
  | "released"
  | "on_hold"
  | "rejected";

export type FinalReleaseFileKind =
  | "coa"
  | "bmr"
  | "micro"
  | "label_proof"
  | "retain_sample";

export const FINAL_RELEASE_FILE_KINDS: FinalReleaseFileKind[] = [
  "coa",
  "bmr",
  "micro",
  "label_proof",
  "retain_sample",
];

export const FILE_KIND_LABEL: Record<FinalReleaseFileKind, string> = {
  coa: "Certificate of Analysis",
  bmr: "Batch Manufacturing Record",
  micro: "Micro / potency test report",
  label_proof: "Label proof",
  retain_sample: "Retention sample photo",
};

/**
 * Sub-caption shown under the kind label on the release form so QA
 * knows exactly what to snap without opening a separate SOP.
 */
export const FILE_KIND_HINT: Record<FinalReleaseFileKind, string> = {
  coa: "Batch's Certificate of Analysis — actives, moisture, micro, heavy metals (BRCGS 5.3.4).",
  bmr: "Full production record — auto-generated from the MO chain if you tap Generate.",
  micro: "Micro or potency lab report signed off by the QC lab.",
  label_proof:
    "Photos of a finished retail unit with the printed label clearly readable — front + back panels showing product name, batch code, expiry, allergens, ingredients (BRCGS 5.4.2).",
  retain_sample:
    "Photo of the physical retention sample sitting on the retention shelf with the batch code visible (BRCGS 5.7).",
};

export interface FinalReleaseActor {
  id: number;
  uuid: string;
  name: string | null;
  email: string | null;
}

export interface FinalReleaseFileRow {
  uuid: string;
  kind: FinalReleaseFileKind;
  filename: string;
  mime: string;
  byte_size: number;
  uploaded_at: string;
  uploaded_by: FinalReleaseActor | null;
}

export interface FinalReleaseLotSummary {
  id: number;
  uuid: string;
  code: string | null;
  status: string;
  qty_received: string | null;
  expiry_at: string | null;
  item: { id: number; uuid: string; name: string; item_type: string } | null;
  placement: {
    cell_uuid: string;
    cell_name: string | null;
    /** 0-based shelf level inside the rack. Used to derive "Level N"
     *  when `cell_name` is null. */
    cell_ordinal: number | null;
    cell_purpose: string;
    location: { uuid: string; name: string | null; code: string | null } | null;
    floor: { uuid: string; name: string | null } | null;
    warehouse: { uuid: string; name: string | null } | null;
  } | null;
  /** 3PL routing snapshot. `ownership_kind = "bailee"` implies 3PL
   *  routing already fired; `routing_choice = "shipment"` marks it
   *  routed for direct dispatch. `null` for both means the released
   *  lot still owes a routing decision. */
  ownership_kind: "own" | "bailee";
  bailee_customer: { id: number; uuid: string; name: string } | null;
  bailee_routed_at: string | null;
  routing_choice: "three_pl" | "shipment" | null;
  package_length_mm: number | null;
  package_width_mm: number | null;
  package_height_mm: number | null;
  units_per_package: number | null;
}

export interface FinalReleaseMoSummary {
  id: number;
  uuid: string;
  code: string | null;
  quantity: string;
  status: string;
  /** Stream marker — the RoutingCard uses this to hide the 3PL
   *  option for sample kits (samples ship direct, never via 3PL
   *  bailee). Null on older responses / non-MO releases. */
  project_type?: "production" | "trial" | "sample" | null;
}

export interface FinalRelease {
  uuid: string;
  status: FinalReleaseStatus;
  notes: string | null;
  hold_reason: string | null;
  reject_reason: string | null;
  releaser_id: number | null;
  releaser: FinalReleaseActor | null;
  releaser_signed_at: string | null;
  approver_id: number | null;
  approver: FinalReleaseActor | null;
  approver_signed_at: string | null;
  finalized_at: string | null;
  finalized_by: FinalReleaseActor | null;
  manufacturing_order: FinalReleaseMoSummary | null;
  stock_lot: FinalReleaseLotSummary | null;
  files: FinalReleaseFileRow[];
  required_file_kinds: FinalReleaseFileKind[];
  /** UUID of the CO that owns this lot's MO. Null for lots without
   *  a CO linkage (opening balance / manual receive). Needed to
   *  hit the routing-request Approve/Decline endpoints. */
  customer_order_uuid: string | null;
  /** Customer-driven 3PL vs shipment routing. Present only when
   *  the CO is bespoke NPD-formulation; null on standard commercial
   *  COs (which keep the operator per-lot picker). */
  customer_routing_request: CustomerRoutingRequest | null;
  inserted_at: string;
  updated_at: string;
}

export type RoutingRequestState =
  | "awaiting_customer"
  | "awaiting_team_review"
  | "applied_three_pl"
  | "applied_shipment";

export interface RoutingEstimateSnapshot {
  required_m3: string;
  free_m3: string;
  capacity_ok: boolean;
  rate_per_m3_per_day: string | null;
  estimated_days: number;
  estimated_daily_charge: string;
  estimated_period_charge: string;
  currency_code: string;
}

export interface CustomerRoutingRequestRow {
  uuid: string;
  state: RoutingRequestState;
  customer_choice: "three_pl" | "shipment" | null;
  team_decision_reason: string | null;
  customer_chose_at: string | null;
  team_reviewed_at: string | null;
  frozen_snapshot: RoutingEstimateSnapshot | null;
}

export interface CustomerRoutingRequest {
  is_custom_formulation: true;
  request: CustomerRoutingRequestRow | null;
  current_snapshot: RoutingEstimateSnapshot | null;
}

export interface FinalReleaseQueueResponse {
  items: FinalRelease[];
  next_cursor?: string | null;
}
