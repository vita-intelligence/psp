import type { AuditActor } from "../types";
import type { InspectionStatus, QualityDecision } from "../goods-in/types";

/**
 * Slim "ledger row" shape for the global procurement inspections
 * page — mirrors `BackendWeb.Payloads.goods_in_inspection_summary/1`.
 * Lighter than the full `Inspection` payload because the desktop
 * ledger doesn't render section JSONBs or per-line items.
 */
export interface InspectionSummary {
  id: number;
  uuid: string;
  /** Rendered display code (`GI00007`) — `null` only when the company
   *  hasn't configured the `goods_in_inspection` numbering format. */
  code: string | null;
  status: InspectionStatus;
  delivery_date: string | null;
  quality_decision: QualityDecision | null;
  goods_in_operator: AuditActor | null;
  goods_in_operator_signed_at: string | null;
  quality_approver: AuditActor | null;
  quality_approver_signed_at: string | null;
  purchase_order: {
    id: number;
    uuid: string;
    code: string | null;
    status: string;
    vendor: {
      id: number;
      uuid: string;
      name: string;
    } | null;
  } | null;
  inserted_at: string;
  updated_at: string;
}

export interface InspectionsLedgerPage {
  items: InspectionSummary[];
  next_cursor: string | null;
}
