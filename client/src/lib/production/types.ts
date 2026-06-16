import type { AuditActor } from "../types";

/** Slim part summary the BOM payload embeds — same shape the
 *  receive form's item picker option carries (id + name + code +
 *  UoM). */
export interface BOMPartSummary {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  item_type: string;
  external_sku: string | null;
  stock_uom: {
    id: number;
    uuid: string;
    code: string | null;
    symbol: string;
    name: string;
  } | null;
}

export interface BOMUomCompact {
  id: number;
  uuid: string;
  code: string | null;
  symbol: string;
  name: string;
}

export interface BOMLine {
  id: number;
  uuid: string;
  bom_id: number;
  sort_order: number;
  qty: string;
  is_fixed: boolean;
  notes: string | null;
  part_id: number;
  part: BOMPartSummary | null;
  unit_of_measurement_id: number | null;
  unit_of_measurement: BOMUomCompact | null;
  /** Most recent `stock_lots.unit_cost` for this part within the
   *  company. Server-computed on the detail payload; `null` when no
   *  receipt has ever landed a cost. */
  average_unit_cost?: string | null;
}

export interface BOMVersion {
  id: number;
  uuid: string;
  version_no: number;
  notes: string | null;
  created_by: { id: number; uuid: string; name: string } | null;
  inserted_at: string;
}

export interface BOM {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  notes: string | null;
  is_primary: boolean;
  is_active: boolean;
  item_id: number;
  item: BOMPartSummary | null;
  lines: BOMLine[];
  /** Append-only history of saves on this BOM. The newest row is
   *  the current state; older rows offer one-click revert. */
  versions?: BOMVersion[];
  inserted_at: string;
  updated_at: string;
  created_by: AuditActor | null;
  updated_by: AuditActor | null;
}

export interface BOMSummary {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  is_primary: boolean;
  is_active: boolean;
  item: BOMPartSummary | null;
  created_by: AuditActor | null;
  updated_by: AuditActor | null;
  inserted_at: string;
  updated_at: string;
}

export interface BOMLedgerPage {
  items: BOMSummary[];
  next_cursor: string | null;
}

/** POST/PATCH /api/production/boms payload. Lines are sent as the
 *  complete current snapshot — backend replaces them wholesale. */
export interface BOMUpsertInput {
  item_id?: number;
  name?: string;
  notes?: string | null;
  is_active?: boolean;
  /** Optional operator-supplied note that explains *why* this save
   *  happened. Stored on the resulting `bom_versions` row so the
   *  history card reads "v3 — adjusted Vitamin C qty after vendor
   *  change". Empty / null is fine. */
  version_notes?: string | null;
  lines: Array<{
    part_id: number;
    qty: string;
    unit_of_measurement_id?: number | null;
    is_fixed?: boolean;
    notes?: string | null;
    sort_order?: number;
  }>;
}

// ---------------------------------------------------------------
// Workstation groups
// ---------------------------------------------------------------

export type WorkstationGroupKind =
  | "active_processing"
  | "passive_processing";

/** Shape of the per-day working-hours override. Mirrors what the
 *  company-level editor produces — open-ended on purpose so the FE
 *  editor can evolve without a type churn. */
export type WorkstationGroupWorkingHours = Record<string, unknown>;

export interface WorkstationGroup {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  notes: string | null;
  instances: number;
  kind: WorkstationGroupKind;
  hourly_rate_enabled: boolean;
  /** Decimal string when present (preserves precision in JSON). */
  hourly_rate: string | null;
  custom_working_hours: boolean;
  working_hours: WorkstationGroupWorkingHours;
  custom_holidays: boolean;
  /** ISO date strings (`YYYY-MM-DD`). */
  holidays: string[];
  color: string | null;
  is_active: boolean;
  created_by: AuditActor | null;
  updated_by: AuditActor | null;
  inserted_at: string;
  updated_at: string;
}

export interface WorkstationGroupSummary {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  kind: WorkstationGroupKind;
  instances: number;
  hourly_rate_enabled: boolean;
  hourly_rate: string | null;
  color: string | null;
  is_active: boolean;
  created_by: AuditActor | null;
  updated_by: AuditActor | null;
  inserted_at: string;
  updated_at: string;
}

export interface WorkstationGroupLedgerPage {
  items: WorkstationGroupSummary[];
  next_cursor: string | null;
}

export interface WorkstationGroupUpsertInput {
  name?: string;
  notes?: string | null;
  instances?: number;
  kind?: WorkstationGroupKind;
  hourly_rate_enabled?: boolean;
  hourly_rate?: string | null;
  custom_working_hours?: boolean;
  working_hours?: WorkstationGroupWorkingHours;
  custom_holidays?: boolean;
  holidays?: string[];
  color?: string | null;
  is_active?: boolean;
}

// ---------------------------------------------------------------
// Workstations
// ---------------------------------------------------------------

export interface WorkstationSiteSummary {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  kind: "warehouse" | "production_facility";
}

export interface WorkstationDefaultWorker {
  id: number;
  uuid: string;
  name: string;
  email: string;
}

export interface Workstation {
  id: number;
  uuid: string;
  code: string | null;
  /** UUID populated by the vita-performance sync job. NULL until
   *  the workstation has been mirrored. Surfaced read-only on the
   *  FE so admins can see the join key without editing it. */
  external_id: string | null;
  name: string;
  notes: string | null;
  workstation_group_id: number;
  workstation_group: WorkstationGroupSummary | null;
  warehouse_id: number;
  warehouse: WorkstationSiteSummary | null;
  hourly_rate_enabled: boolean;
  /** Decimal string when set. */
  hourly_rate: string | null;
  /** Computed by the BE — workstation rate when toggle on, else the
   *  group's rate (when its toggle is on), else `null`. The form's
   *  inheritance label reads this. */
  effective_hourly_rate: string | null;
  productivity: string;
  idle_from: string | null;
  idle_to: string | null;
  is_active: boolean;
  default_workers: WorkstationDefaultWorker[];
  created_by: AuditActor | null;
  updated_by: AuditActor | null;
  inserted_at: string;
  updated_at: string;
}

export interface WorkstationSummary {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  workstation_group: WorkstationGroupSummary | null;
  warehouse: WorkstationSiteSummary | null;
  productivity: string;
  hourly_rate_enabled: boolean;
  hourly_rate: string | null;
  is_active: boolean;
  idle_from: string | null;
  idle_to: string | null;
  inserted_at: string;
  updated_at: string;
}

export interface WorkstationLedgerPage {
  items: WorkstationSummary[];
  next_cursor: string | null;
}

export interface WorkstationUpsertInput {
  name?: string;
  notes?: string | null;
  workstation_group_id?: number;
  warehouse_id?: number;
  hourly_rate_enabled?: boolean;
  hourly_rate?: string | null;
  productivity?: string | number;
  idle_from?: string | null;
  idle_to?: string | null;
  is_active?: boolean;
  /** Wholesale replace — BE wipes the M2M set and reinserts the
   *  ids sent here inside the same transaction. */
  default_worker_ids?: number[];
}
