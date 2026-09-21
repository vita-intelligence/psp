import type { AuditActor, StockLotCellSummary } from "../types";

/** Lifecycle presence — physical state only. Operational
 *  availability (needs maintenance, out for repair, calibration due)
 *  is derived from the MaintenanceTask + Repair records, never from
 *  this field. See ``Backend.Equipment.Lifecycle`` moduledoc. */
export type EquipmentStatus =
  | "expected"
  | "received"
  | "in_service"
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
  /** Cleaning cadence (new fields). Auditor-distinct from the
   *  workstation-level cleaning cadence — a machine can have its
   *  own CIP schedule independent of the cell it lives in. */
  cleaning_periodicity: string | null;
  cleaning_periodicity_interval: number | null;
  last_cleaning_at: string | null;
  next_cleaning_due_at: string | null;
  retired_at: string | null;
  disposed_at: string | null;
  notes: string | null;
  /** Optional workstation the unit is attached to. When set, the
   *  unit's `hourly_running_cost` participates in that workstation's
   *  cost roll-up during MO cost breakdowns. */
  /** Free-text location for units that aren't in a storage cell
   *  (office monitors, wall-mounted displays, reception AV). Detail
   *  page shows `assigned_to > current_cell > location_description`. */
  location_description: string | null;
  workstation_id: number | null;
  workstation: {
    id: number;
    uuid: string;
    name: string;
  } | null;
  /** SUM of active running-cost components while operating. Populated
   *  by `Backend.Equipment.RunningCosts.recompute_cache/1` on the
   *  backend — never write to this from the FE. */
  hourly_running_cost: string | null;
  hourly_running_cost_currency: string | null;
  item: {
    id: number;
    uuid: string;
    code: string | null;
    name: string;
  } | null;
  category_id: number | null;
  category: EquipmentCategorySummary | null;
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

/** Asset category — grouping label with operator-facing defaults
 *  propagated to new equipment rows. See
 *  ``Backend.Equipment.Category``. */
export interface EquipmentCategory {
  id: number;
  uuid: string;
  name: string;
  notes: string | null;
  is_active: boolean;
  default_useful_life_years: number | null;
  default_calibration_frequency_months: number | null;
  default_maintenance_frequency_months: number | null;
  inserted_at: string;
  updated_at: string;
}

export interface EquipmentCategorySummary {
  id: number;
  uuid: string;
  name: string;
  is_active: boolean;
}

/** One line item on an equipment unit's hourly running-cost stack.
 *  Sums across active rows land on
 *  ``equipment.hourly_running_cost`` for the workstation roll-up. */
export interface EquipmentRunningCostComponent {
  id: number;
  uuid: string;
  equipment_id: number;
  label: string;
  amount_per_hour: string;
  currency: string | null;
  notes: string | null;
  is_active: boolean;
  inserted_at: string;
  updated_at: string;
}

/** Preventive-maintenance / calibration task attached to an
 *  equipment unit. See ``Backend.Equipment.MaintenanceTask``. */
export type MaintenanceTaskType =
  | "preventive"
  | "calibration"
  | "inspection"
  | "safety_check"
  | "cleaning"
  | "other";

export type MaintenancePeriodicity =
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "half_yearly"
  | "yearly"
  | "two_yearly"
  | "three_yearly";

export interface EquipmentMaintenanceTask {
  id: number;
  uuid: string;
  equipment_id: number;
  task_name: string;
  task_type: MaintenanceTaskType;
  periodicity: MaintenancePeriodicity | null;
  periodicity_interval: number | null;
  start_date: string | null;
  end_date: string | null;
  last_completion_date: string | null;
  next_due_date: string | null;
  certificate_required: boolean;
  notes: string | null;
  is_active: boolean;
  assigned_to_user: AuditActor | null;
  created_by: AuditActor | null;
  updated_by: AuditActor | null;
  inserted_at: string;
  updated_at: string;
}

/** Reactive breakdown / repair record. See ``Backend.Equipment.Repair``. */
export type RepairStatus = "reported" | "in_progress" | "completed" | "canceled";

export interface EquipmentRepairPart {
  id: number;
  uuid: string;
  repair_id: number;
  item_id: number;
  item: { id: number; name: string; external_sku: string | null } | null;
  quantity: string;
  unit_cost: string | null;
  currency: string | null;
  line_total: string | null;
  notes: string | null;
  inserted_at: string;
  updated_at: string;
}

export interface EquipmentRepair {
  id: number;
  uuid: string;
  equipment_id: number;
  failure_date: string;
  started_at: string | null;
  completion_date: string | null;
  downtime_minutes: number | null;
  status: RepairStatus;
  description: string | null;
  actions_performed: string | null;
  repair_cost: string | null;
  currency: string | null;
  external_vendor_name: string | null;
  notes: string | null;
  assigned_to_user: AuditActor | null;
  parts: EquipmentRepairPart[] | null;
  parts_total: string | null;
  inserted_at: string;
  updated_at: string;
}
