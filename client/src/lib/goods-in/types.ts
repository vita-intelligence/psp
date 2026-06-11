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
  /** `true` = the operator ticked Yes (compliant), `false` = No (issue). */
  passed: boolean;
  /** Free-text observations — required when `passed === false` so the
   *  audit trail explains what was off. */
  notes: string | null;
}

/** Section JSONB bag — a map from check_key → SectionCheck. */
export type SectionBag = Record<string, SectionCheck>;

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
  quality_approver: AuditActor | null;
  quality_approver_signed_at: string | null;
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

/** Per-line decision payload — POST /goods-in-inspections/:id/items/:line_uuid. */
export interface InspectionItemUpsertInput {
  qty_received: string;
  packaging_condition?: PackagingCondition;
  packaging_condition_notes?: string | null;
  material_decision: MaterialDecision;
  material_decision_reason?: string | null;
}
