import type { AuditActor, PurchaseOrder, PurchaseOrderLine } from "../types";

/**
 * Goods-In Inspection TS shapes — mirrors `BackendWeb.Payloads.goods_in_inspection/1`
 * + `goods_in_inspection_item/1` + `goods_in_inspection_file/2`.
 *
 * Status flow:
 *   draft → sign_operator → submitted → sign_quality → approved | hold | rejected
 *
 * Section JSONB bags carry `{ [check_key]: { passed, notes } }`. The
 * allowed key registry per section lives in the wizard component so
 * the UI can render and label each check without a server round-trip.
 */

export type InspectionStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "hold"
  | "rejected";

export type QualityDecision = "approved" | "hold" | "rejected";

export type PackagingCondition = "good" | "damaged";

export type MaterialDecision = "accept" | "hold" | "reject";

export type InspectionFileKind = "photo" | "coa" | "other";

/** One yes/no check inside a section JSONB bag. */
export interface SectionCheck {
  /** `true` = the operator ticked Yes (compliant) OR ticked N/A,
   *  `false` = No (issue). N/A is disambiguated by the `na` flag. */
  passed: boolean;
  /** Free-text observations — required when `passed === false` so the
   *  audit trail explains what was off. */
  notes: string | null;
  /** `true` = operator explicitly marked the check as Not Applicable
   *  (e.g. seal intact when the load wasn't sealed). Stored alongside
   *  `passed: true` so existing readers still see "not a failure"
   *  while audit / display can distinguish "compliant" from "N/A". */
  na?: boolean;
}

/** Section JSONB bag — a map from check_key → SectionCheck. */
export type SectionBag = Record<string, SectionCheck>;

/** One physical pack within a per-line decision. The PO's qty for a
 *  line can arrive split across multiple packs (4×25 kg drums + 1×50
 *  kg sack = 5 packs); on QC approval each pack materialises as its
 *  own stock_lot, mirroring the manual-lot creation flow. */
export interface InspectionItemPack {
  qty: string;
  package_length_mm: number;
  package_width_mm: number;
  package_height_mm: number;
  package_weight_kg: string;
  units_per_package: number;
  /** Operator-set vertical-stacking cap — max units the warehouse can
   *  safely stack on top of each other for this pack. Drives cell
   *  suitability + the resulting lot's `stack_factor`. Defaults to 1
   *  (no vertical stacking) when omitted. */
  stack_factor?: number;
  /** Optional per-pack override of the line's batch number. */
  supplier_batch_no?: string | null;
  /** ISO 3166-1 alpha-2 country code (e.g. "IT", "GB") — from the
   *  pack's printed label or the vendor's CoA. */
  country_of_origin?: string | null;
  /** Vendor's spec / artwork revision printed on the pack. Free
   *  text — vendors don't share a single revision scheme. */
  revision?: string | null;
  /** ISO date (YYYY-MM-DD) — date the batch was produced. */
  manufactured_at?: string | null;
  /** ISO date — best-before / use-by from the pack label. Falls back
   *  to `manufactured_at + item.default_shelf_life_months` on the
   *  server when omitted. */
  expiry_at?: string | null;
}

export interface InspectionItem {
  id: number;
  uuid: string;
  purchase_order_line_id: number;
  /** Parent PO line uuid — present when the inspection was fetched
   *  via `GoodsIn.get/2` (which preloads `items: [:purchase_order_line]`).
   *  The wizard joins on this so it can rebuild local state from the
   *  server-returned items list without having a line.id on the public
   *  PO payload. */
  purchase_order_line_uuid: string | null;
  qty_received: string;
  packaging_condition: PackagingCondition | null;
  packaging_condition_notes: string | null;
  material_decision: MaterialDecision;
  material_decision_reason: string | null;
  /** Pack breakdown — empty list means "legacy single implicit pack
   *  of size qty_received" so old inspections render correctly. */
  packs: InspectionItemPack[];
  inserted_at: string;
  updated_at: string;
}

export interface InspectionFile {
  id: number;
  uuid: string;
  kind: InspectionFileKind;
  filename: string;
  mime: string;
  byte_size: number;
  /** Serve URL scoped under the parent inspection. Resolves via the
   *  FE proxy at `/api/m/inspections/:uuid/files/:fileUuid/serve`. */
  url: string;
  uploaded_at: string;
  uploaded_by: AuditActor | null;
}

export interface Inspection {
  id: number;
  uuid: string;
  status: InspectionStatus;
  delivery_date: string | null;
  delivery_time: string | null;
  transport_company: string | null;
  vehicle_registration: string | null;
  seal_number: string | null;
  vehicle_inspection: SectionBag;
  documentation_verification: SectionBag;
  physical_inspection: SectionBag;
  food_safety_checks: SectionBag;
  storage_verification: SectionBag;
  quality_decision: QualityDecision | null;
  quality_decision_reason: string | null;
  goods_in_operator: AuditActor | null;
  goods_in_operator_signed_at: string | null;
  /** Base64 data URL of the operator's scrawled signature — only
   *  present on the detail payload (`getInspection`), never on the
   *  ledger summary because of the size. */
  goods_in_operator_signature_image: string | null;
  quality_approver: AuditActor | null;
  quality_approver_signed_at: string | null;
  /** Base64 data URL of the approver's signature. Same caveat as the
   *  operator one — detail payload only. */
  quality_approver_signature_image: string | null;
  purchase_order_id: number;
  /** Parent PO uuid — present whenever the inspection was loaded via
   *  `GoodsIn.get/2` (which preloads `:purchase_order`). The FE uses
   *  it to fetch the PO for line metadata without having to round-trip
   *  through the integer id. */
  purchase_order_uuid: string | null;
  items: InspectionItem[];
  files: InspectionFile[];
  inserted_at: string;
  updated_at: string;
}

/** Convenience: full inspection-page context — the wizard always needs
 *  both the inspection AND the parent PO + its lines to render. */
export interface InspectionContext {
  inspection: Inspection;
  purchase_order: PurchaseOrder;
  lines: PurchaseOrderLine[];
}

/** Patch input for the delivery-info path of `PATCH /api/goods-in-inspections/:id`. */
export interface InspectionDeliveryInfoPatch {
  delivery_date?: string;
  delivery_time?: string | null;
  transport_company?: string | null;
  vehicle_registration?: string | null;
  seal_number?: string | null;
}

/** Patch input for the section-JSONB path of `PATCH /api/goods-in-inspections/:id`. */
export interface InspectionSectionPatch {
  section:
    | "vehicle_inspection"
    | "documentation_verification"
    | "physical_inspection"
    | "food_safety_checks"
    | "storage_verification";
  value: SectionBag;
}

/** Per-line decision payload — POST /goods-in-inspections/:id/items/:line_uuid.
 *  When `packs` is a non-empty list, the BE reconciles `qty_received`
 *  to `sum(packs[].qty)` server-side, so the FE only needs to pass
 *  `qty_received` for legacy single-pack mode. */
export interface InspectionItemUpsertInput {
  qty_received: string;
  packaging_condition?: PackagingCondition;
  packaging_condition_notes?: string | null;
  material_decision: MaterialDecision;
  material_decision_reason?: string | null;
  packs?: InspectionItemPack[];
}
