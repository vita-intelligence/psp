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
  /** Long-form SOP / operation description. Prefills the routing-step
   *  + MO-step `operation_description` when this group is picked. */
  default_operation_notes: string | null;
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
  /** Group's own default. NULL ⇒ inherit nothing at this level. */
  default_operation_notes: string | null;
  /** BE-resolved: group's own value when set, otherwise a station-
   *  level fallback (so a default typed on any workstation in this
   *  group still surfaces here). Routings + MO snapshots read this. */
  effective_default_operation_notes: string | null;
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
  default_operation_notes?: string | null;
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
  /** Station-level override for the group's default operation notes.
   *  NULL ⇒ inherit. */
  default_operation_notes: string | null;
  /** BE-computed: station override when set, else group default,
   *  else null. The form renders the inheritance hint off this. */
  effective_operation_notes: string | null;
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
  default_operation_notes?: string | null;
  /** Wholesale replace — BE wipes the M2M set and reinserts the
   *  ids sent here inside the same transaction. */
  default_worker_ids?: number[];
}

// ---------------------------------------------------------------
// Routings
// ---------------------------------------------------------------

export interface RoutingStepWorker {
  id: number;
  uuid: string;
  name: string;
  email: string;
}

export interface RoutingStep {
  id: number;
  uuid: string;
  sort_order: number;
  operation_description: string | null;
  setup_time_min: string | null;
  cycle_time_min: string | null;
  fixed_cost: string | null;
  variable_cost: string | null;
  capacity: string;
  workstation_group_id: number;
  workstation_group: WorkstationGroupSummary | null;
  workers: RoutingStepWorker[];
}

export interface Routing {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  notes: string | null;
  is_active: boolean;
  company_id: number;
  item_id: number;
  item: BOMPartSummary | null;
  bom_id: number | null;
  bom: BOMSummary | null;
  other_fixed_cost: string | null;
  other_variable_cost: string | null;
  other_variable_cost_basis: string;
  steps: RoutingStep[];
  created_by: AuditActor | null;
  updated_by: AuditActor | null;
  inserted_at: string;
  updated_at: string;
}

export interface RoutingSummary {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  is_active: boolean;
  item: BOMPartSummary | null;
  bom: BOMSummary | null;
  created_by: AuditActor | null;
  updated_by: AuditActor | null;
  inserted_at: string;
  updated_at: string;
}

export interface RoutingLedgerPage {
  items: RoutingSummary[];
  next_cursor: string | null;
}

/** POST/PATCH /api/production/routings payload. `steps` is sent as
 *  the full current snapshot — BE wipes + reinserts inside one
 *  transaction. Omit `steps` on PATCH to keep the existing set. */
export interface RoutingUpsertInput {
  item_id?: number;
  bom_id?: number | null;
  name?: string;
  notes?: string | null;
  is_active?: boolean;
  other_fixed_cost?: string | null;
  other_variable_cost?: string | null;
  other_variable_cost_basis?: string | number;
  steps?: Array<{
    workstation_group_id: number;
    operation_description?: string | null;
    setup_time_min?: string | null;
    cycle_time_min?: string | null;
    fixed_cost?: string | null;
    variable_cost?: string | null;
    capacity?: string | number;
    sort_order?: number;
    default_worker_ids?: number[];
  }>;
}

// ---------------------------------------------------------------
// Manufacturing orders
// ---------------------------------------------------------------

export type ManufacturingOrderStatus =
  | "draft"
  | "prepared"
  | "approved"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled";

export type MOSignatureAction =
  | "prepare"
  | "unprepare"
  | "approve"
  | "reject"
  | "amend";

// ---------------------------------------------------------------
// Production schedule
// ---------------------------------------------------------------

export interface ScheduleOperationMOSummary {
  id: number;
  uuid: string;
  code: string | null;
  status: ManufacturingOrderStatus;
  quantity: string;
  item: BOMPartSummary | null;
  warehouse_id: number;
  /** Set when this MO is a sub-MO; used by the project view to walk
   *  up to the root. */
  parent_mo_id: number | null;
}

export interface PlannedSegment {
  start_at: string;
  finish_at: string;
}

export interface ScheduleOperation {
  id: number;
  uuid: string;
  manufacturing_order_id: number;
  manufacturing_order: ScheduleOperationMOSummary | null;
  workstation_group_id: number | null;
  workstation_group: WorkstationGroupSummary | null;
  operation_description: string | null;
  planned_start: string | null;
  planned_finish: string | null;
  /** Preserved across unschedule — the calendar uses this to lay
   *  out steps when an MO is dropped from the backlog. */
  planned_duration_seconds: number;
  /** Explicit segments the planner pinned via the click-to-edit
   *  dialog. NULL → walker derives segments at render time. Set →
   *  literal source of truth, walker stays out. Pauses = gaps. */
  planned_segments: PlannedSegment[] | null;
  actual_start: string | null;
  actual_finish: string | null;
  quantity: string | null;
  sort_order: number;
}

export interface BacklogMOStep {
  id: number;
  uuid: string;
  sort_order: number;
  operation_description: string | null;
  planned_duration_seconds: number;
  workstation_group: WorkstationGroupSummary | null;
}

export interface BacklogMO {
  id: number;
  uuid: string;
  code: string | null;
  status: ManufacturingOrderStatus;
  revision: string;
  quantity: string;
  due_date: string | null;
  item: BOMPartSummary | null;
  bom: BOMSummary | null;
  assigned_to: AuditActor | null;
  /** Sum of step durations — how wide the block will be on the
   *  calendar once dropped. */
  planned_duration_seconds: number;
  step_count: number;
  /** Lets the FE group rows as project > MO. May point to an MO
   *  that's already scheduled (not in the backlog) — in that
   *  case the FE treats this MO as a root of its own subtree. */
  parent_mo_id: number | null;
  steps_summary: BacklogMOStep[];
}

export interface ScheduleWindowInterval {
  open: string;
  close: string;
}

export interface ScheduleDayWindow {
  date: string;
  holiday_label: string | null;
  intervals: ScheduleWindowInterval[];
}

export interface ScheduleGroupWindows {
  group_id: number;
  days: ScheduleDayWindow[];
}

export interface ProductionScheduleResponse {
  warehouse: {
    id: number;
    uuid: string;
    name: string;
    kind: "warehouse" | "production_facility";
    timezone: string | null;
  };
  range: { from: string; to: string };
  workstation_groups: WorkstationGroupSummary[];
  operations: ScheduleOperation[];
  working_windows: ScheduleGroupWindows[];
  backlog: BacklogMO[];
}

export interface ManufacturingOrderSiteSummary {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
  kind: "warehouse" | "production_facility";
}

export interface ManufacturingOrderRelation {
  id: number;
  uuid: string;
  code: string | null;
  status: ManufacturingOrderStatus;
  quantity: string;
  revision?: string;
  /** Derived from step times — null when the MO is unscheduled. */
  start_at?: string | null;
  /** Derived from step times — null when the MO is unscheduled. */
  finish_at?: string | null;
  item: BOMPartSummary | null;
}

export interface ManufacturingOrderConsumerLink {
  id: number;
  uuid: string;
  shared_qty: string;
  consumer_mo: ManufacturingOrderRelation | null;
}

export interface ManufacturingOrderSupplierLink {
  id: number;
  uuid: string;
  shared_qty: string;
  batch_mo: ManufacturingOrderRelation | null;
}

export interface ManufacturingOrderMergeCandidate {
  id: number;
  uuid: string;
  code: string | null;
  status: ManufacturingOrderStatus;
  quantity: string;
  item: { id: number; name: string };
  parent_mo: { id: number; uuid: string; code: string | null } | null;
}

/** One node in the MO chain — root + every descendant — flat with
 *  parent_mo_id so the FE can rebuild the tree. */
export interface ManufacturingOrderChainNode {
  id: number;
  uuid: string;
  code: string | null;
  status: ManufacturingOrderStatus;
  quantity: string;
  parent_mo_id: number | null;
  item: BOMPartSummary | null;
}

export interface ManufacturingOrderRoutingSummary {
  id: number;
  uuid: string;
  code: string | null;
  name: string;
}

export interface ManufacturingOrderPart {
  id: number;
  uuid: string;
  sort_order: number;
  is_fixed: boolean;
  part: BOMPartSummary | null;
  unit_of_measurement: {
    id: number;
    uuid: string;
    name: string;
    symbol: string;
    dimension: string;
  } | null;
  /** Per-output qty from the BOM line. */
  line_qty: string | null;
  /** `line_qty × MO quantity` (or just `line_qty` when the line is
   *  flagged is_fixed). Display column "Required". */
  required_qty: string | null;
  unit_cost: string | null;
  total_cost: string | null;
  /** Sum of active bookings against this line. */
  booked_qty: string | null;
  /** Sum of consumed across active bookings. */
  consumed_qty: string | null;
  /** Sum of qty being produced by open child MOs feeding this part. */
  pending_from_sub_mos_qty: string | null;
  /** Required - booked - pending. Nil when zero (line fully covered) or
   *  when required can't be computed. FE renders a synthetic red
   *  'Not booked' sub-row when this is > 0. */
  unbooked_qty: string | null;
  /** Derived coverage state — drives the master-row badge.
   *  - `booked`              fully covered by reserved real stock
   *  - `sub_mo_in_progress`  covered, but sub-MO contributes majority
   *  - `partial`             gap exists, no sub-MO covering it
   *  - `not_booked`          nothing covered
   *  - `unknown`             required qty couldn't be computed */
  coverage_status:
    | "booked"
    | "sub_mo_in_progress"
    | "partial"
    | "not_booked"
    | "unknown";
  /** Real bookings against existing lots. Render with status
   *  label "Booked". */
  bookings: ManufacturingOrderBooking[];
  /** Open child MOs producing this part — render as additional
   *  amber "Awaiting production from MO-XXX" sub-rows on the FE. */
  pending_from_sub_mos: ManufacturingOrderRelation[];
  /** Legacy single-row columns — always null now that bookings can
   *  stack against a line. Kept on the type so older payload
   *  consumers don't break. */
  lot: string | null;
  status: string | null;
  storage_location: string | null;
  available_from: string | null;
}

export interface ManufacturingOrderBookingLotSummary {
  id: number;
  uuid: string;
  code: string | null;
  status: string;
  expiry_at: string | null;
  available_from: string | null;
}

export interface ManufacturingOrderBookingCellSummary {
  id: number;
  uuid: string;
  name: string | null;
  purpose: string;
}

export type ManufacturingOrderBookingStatus =
  | "requested"
  | "consumed"
  | "cancelled";

export interface ManufacturingOrderBooking {
  id: number;
  uuid: string;
  quantity: string;
  consumed_quantity: string;
  status: ManufacturingOrderBookingStatus;
  note: string | null;
  item_id: number;
  item: BOMPartSummary | null;
  stock_lot_id: number;
  stock_lot: ManufacturingOrderBookingLotSummary | null;
  storage_cell_id: number | null;
  storage_location: ManufacturingOrderBookingCellSummary | null;
  manufacturing_order_id: number;
  inserted_at: string;
  updated_at: string;
}

export interface BookableLot {
  id: number;
  uuid: string;
  code: string | null;
  status: string;
  manufactured_at: string | null;
  expiry_at: string | null;
  available_from: string | null;
  unit_cost: string | null;
  currency: string | null;
  supplier_batch_no: string | null;
  available_qty: string;
  storage_location: ManufacturingOrderBookingCellSummary | null;
}

export interface ManufacturingOrderBookingUpsertInput {
  item_id?: number;
  stock_lot_id?: number;
  storage_cell_id?: number | null;
  quantity?: string | number;
  note?: string | null;
}

export interface ManufacturingOrderOperation {
  id: number;
  uuid: string;
  sort_order: number;
  operation_description: string | null;
  setup_time_min: string | null;
  cycle_time_min: string | null;
  fixed_cost: string | null;
  variable_cost: string | null;
  capacity: string;
  workstation_group: WorkstationGroupSummary | null;
  /** Reserved for the execution layer. Specific workstation
   *  selection lands when that ships. */
  workstation?: { id: number; uuid: string; name: string } | null;
  /** Assigned workers — defaults snapshotted from the routing
   *  template's per-step defaults, then editable per-MO. */
  workers: Array<{ id: number; uuid: string; name: string; email: string }>;
  /** Computed default at snapshot time; editable per-MO. Null
   *  while the MO is in the backlog (not yet scheduled). */
  planned_start: string | null;
  planned_finish: string | null;
  /** Preserved across unschedule. Routing-preview rows expose
   *  the routing duration here. */
  planned_duration_seconds?: number;
  /** Filled in via the operator's modify-operation page (or by
   *  the execution layer once it ships). */
  actual_start: string | null;
  actual_finish: string | null;
  applied_overhead_cost: string | null;
  labor_cost: string | null;
  /** Actual produced quantity on this op (defaults to MO qty on
   *  snapshot; partial runs / scrap let it diverge). */
  quantity: string | null;
  /** True for rows from the per-MO snapshot (have a uuid the edit
   *  page can route to). Legacy live-projection rows are false. */
  editable: boolean;
}

export interface ManufacturingOrderStep extends ManufacturingOrderOperation {
  notes: string | null;
  workstation_group_id: number | null;
  routing_step_id: number | null;
  manufacturing_order_id: number;
  manufacturing_order: {
    id: number;
    uuid: string;
    code: string | null;
    status: ManufacturingOrderStatus;
    quantity: string;
  } | null;
  created_by: AuditActor | null;
  updated_by: AuditActor | null;
  inserted_at: string;
  updated_at: string;
}

export interface ManufacturingOrderStepUpsertInput {
  operation_description?: string | null;
  workstation_group_id?: number;
  planned_start?: string | null;
  planned_finish?: string | null;
  actual_start?: string | null;
  actual_finish?: string | null;
  applied_overhead_cost?: string | null;
  labor_cost?: string | null;
  quantity?: string | null;
  notes?: string | null;
  worker_ids?: number[];
}

export interface ManufacturingOrder {
  id: number;
  uuid: string;
  code: string | null;
  status: ManufacturingOrderStatus;
  revision: string;
  quantity: string;
  due_date: string | null;
  /** Derived from min(steps.planned_start) — null when unscheduled. */
  start_at: string | null;
  /** Derived from max(steps.planned_finish) — null when unscheduled. */
  finish_at: string | null;
  expiry_date: string | null;
  notes: string | null;
  warehouse_id: number;
  warehouse: ManufacturingOrderSiteSummary | null;
  item_id: number;
  item: BOMPartSummary | null;
  bom_id: number;
  bom: BOMSummary | null;
  routing_id: number | null;
  routing: ManufacturingOrderRoutingSummary | null;
  /** Set when this MO was auto-spawned to cover a semi-finished
   *  shortfall on another MO. */
  parent_mo_id: number | null;
  parent_mo: ManufacturingOrderRelation | null;
  /** Auto-spawned children that produce semi-finished inputs this
   *  MO consumes. Empty when nothing was cascaded. */
  children: ManufacturingOrderRelation[];
  /** Children whose status is not yet completed/cancelled — drives
   *  the "Waiting on N sub-MO" pill in the header. */
  blocking_children_count: number;
  /** Secondary consumer links — extra MOs that pull from this MO
   *  as a shared batch (beyond the primary parent_mo). */
  consumer_links: ManufacturingOrderConsumerLink[];
  /** Supplier links — shared batches that feed THIS MO via merge. */
  supplier_links: ManufacturingOrderSupplierLink[];
  /** Full MO chain centered on this one (root + all descendants).
   *  Empty when the MO has no parent and no children. */
  chain: ManufacturingOrderChainNode[];
  assigned_to_id: number;
  assigned_to: AuditActor | null;
  approved_by_id: number | null;
  approved_by: AuditActor | null;
  approved_at: string | null;
  /** 1st signature — set when the planner marks the tree prepared. */
  prepared_by_id: number | null;
  prepared_by: AuditActor | null;
  prepared_at: string | null;
  /** Set when the approver rejects a prepared MO. Cleared on the
   *  next prepare cycle. Shown as a banner. */
  rejection_reason: string | null;
  /** Materials cost = sum(bom_line × MO qty × unit_cost). */
  approximate_cost: string | null;
  materials_cost: string | null;
  /** materials_cost / MO quantity. */
  cost_per_unit: string | null;
  parts: ManufacturingOrderPart[];
  operations: ManufacturingOrderOperation[];
  created_by: AuditActor | null;
  updated_by: AuditActor | null;
  inserted_at: string;
  updated_at: string;
}

export interface ManufacturingOrderSummary {
  id: number;
  uuid: string;
  code: string | null;
  status: ManufacturingOrderStatus;
  revision: string;
  quantity: string;
  due_date: string | null;
  /** Derived from steps; null when unscheduled. */
  start_at: string | null;
  /** Derived from steps; null when unscheduled. */
  finish_at: string | null;
  item: BOMPartSummary | null;
  bom: BOMSummary | null;
  warehouse: ManufacturingOrderSiteSummary | null;
  assigned_to: AuditActor | null;
  prepared_by: AuditActor | null;
  prepared_at: string | null;
  approved_by: AuditActor | null;
  approved_at: string | null;
  created_by: AuditActor | null;
  updated_by: AuditActor | null;
  inserted_at: string;
  updated_at: string;
}

export interface ManufacturingOrderLedgerPage {
  items: ManufacturingOrderSummary[];
  next_cursor: string | null;
}

export interface ManufacturingOrderUpsertInput {
  warehouse_id?: number;
  item_id?: number;
  bom_id?: number;
  routing_id?: number | null;
  /** Set when manually spawning a sub-MO under another MO from the
   *  parts table 'Add sub-MO' dialog. Auto-cascade also sets this. */
  parent_mo_id?: number | null;
  quantity?: string | number;
  due_date?: string | null;
  expiry_date?: string | null;
  assigned_to_id?: number;
  revision?: string;
  notes?: string | null;
}
