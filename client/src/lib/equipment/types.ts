import type { AuditActor, StockLotCellSummary } from "../types";

export type EquipmentStatus =
  | "expected"
  | "received"
  | "in_service"
  | "under_maintenance"
  | "out_for_repair"
  | "awaiting_calibration"
  | "retired"
  | "disposed"
  | "canceled";

/** A serial-tracked physical unit — mixer, scale, forklift, laptop.
 *  Distinct from a stock lot: equipment tracks identity per unit
 *  (not qty per batch). */
export interface Equipment {
  id: number;
  uuid: string;
  code: string | null;
  serial_number: string;
  manufacturer_serial: string | null;
  manufacturer: string | null;
  model: string | null;
  status: EquipmentStatus;
  unit_cost: string | null;
  currency: string | null;
  acquired_at: string | null;
  warranty_end_at: string | null;
  useful_life_years: number | null;
  calibration_frequency_months: number | null;
  last_calibrated_at: string | null;
  next_calibration_at: string | null;
  maintenance_frequency_months: number | null;
  last_maintenance_at: string | null;
  next_maintenance_at: string | null;
  retired_at: string | null;
  disposed_at: string | null;
  notes: string | null;
  item: {
    id: number;
    uuid: string;
    code: string | null;
    name: string;
  } | null;
  current_cell: StockLotCellSummary | null;
  assigned_to: AuditActor | null;
  purchase_order_line: {
    id: number;
    uuid: string;
    purchase_order_id: number;
  } | null;
  created_by: AuditActor | null;
  inserted_at: string;
  updated_at: string;
}

/** One row from `GET /api/equipment/due-soon` — an upcoming
 *  calibration or maintenance milestone. */
export interface EquipmentDueRow {
  due_kind: "calibration" | "maintenance";
  due_at: string;
  days_until: number;
  equipment: Equipment;
}

/** Lifecycle event row — history of the unit's status changes,
 *  maintenance actions, calibrations, moves, assignments. */
export interface EquipmentEvent {
  id: number;
  uuid: string;
  kind: string;
  actor: AuditActor | null;
  actor_kind: "user" | "system";
  reason: string | null;
  metadata: Record<string, unknown>;
  from_cell: StockLotCellSummary | null;
  to_cell: StockLotCellSummary | null;
  assigned_to_user: AuditActor | null;
  occurred_at: string;
  inserted_at: string;
}

/** File attached to an equipment unit — calibration certs, service
 *  reports, warranty PDFs, nameplate photos. */
export type EquipmentFileKind =
  | "calibration_certificate"
  | "service_report"
  | "manual"
  | "warranty"
  | "photo"
  | "other";

export interface EquipmentFile {
  id: number;
  uuid: string;
  equipment_id: number;
  kind: EquipmentFileKind;
  filename: string;
  mime: string;
  byte_size: number;
  uploaded_by: AuditActor | null;
  inserted_at: string;
  updated_at: string;
}
