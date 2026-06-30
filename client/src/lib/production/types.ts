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
  /** Capacity = count of active Workstation rows in this group. The
   *  scheduler reads this to know how many ops can run in parallel. */
  workstation_count: number;
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
  /** Capacity = count of active Workstation rows in this group. */
  workstation_count: number;
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
  | "unapprove"
  | "reject"
  | "amend"
  | "request_purchases"
  | "cancel_purchase_request";

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
  /** Warehouse pickup state — drives the Release button + "released"
   *  badge on schedule blocks. */
  released_to_warehouse_at: string | null;
  pickup_window_hours: number | null;
  pickup_started_at: string | null;
  pickup_completed_at: string | null;
  /** Count of booked raw_material / packaging lots that are still in
   *  quarantine (not yet "available"). Surfaced on the calendar block
   *  + edit dialog so the planner knows what blocks Release before
   *  clicking it. 0 means every booked lot is QC-cleared. */
  qc_pending_count: number;
  /** Count of bookings the system can no longer satisfy — lot fell
   *  out of `available` after release, or peer MO consumed more than
   *  expected (lot is over-allocated). > 0 → planner needs to pull
   *  the MO back and re-book. */
  broken_bookings_count: number;
  /** Count of BOM lines that aren't fully covered by bookings
   *  (booked < required). Catches MOs scheduled before the
   *  release-time line-coverage gate landed. > 0 → planner needs
   *  to book more lots or spawn a child MO. */
  under_booked_count: number;
  /** Detail rows for broken bookings — drives the per-row "what's
   *  wrong + where to fix" guidance in the release dialog instead
   *  of a generic count. Length equals broken_bookings_count. */
  broken_bookings: BrokenBooking[];
  /** Detail rows for under-booked BOM lines (item + shortage qty).
   *  Length equals under_booked_count. */
  under_booked_lines: UnderBookedLine[];
  /** BOM lines covered by an open child MO but missing a real lot
   *  booking. Passes the prepare gate (because pending child output
   *  closes the gap), but BLOCKS release (picker needs real lots).
   *  Empty for MOs without sub-MOs. */
  lines_awaiting_child_output: AwaitingChildLine[];
  /** Bookings whose lot isn't fully placed in a `regular` warehouse
   *  cell — typically still sitting at production_feed after the
   *  child MO finished. Picker can't grab it from there. */
  bookings_lot_off_warehouse: LotOffWarehouseRow[];
  /** True when the MO has bounced back from scheduled/in-progress
   *  because the plan broke (Output QC fail, lot rejected,
   *  over-consumption). Release is gated until the planner calls
   *  /clear-replan after fixing the bookings. */
  needs_replan: boolean;
  needs_replan_reason: string | null;
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
    | "expecting"
    | "awaiting_po"
    | "not_booked"
    | "consumed"
    | "consumed_short"
    | "consumed_none"
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
  /** Total qty across all placements — drives the closeout page's
   *  "booked 1.0 / on hand 2.5 kg" info row so operators can verify
   *  the lot still has enough to consume against. */
  qty_on_hand: string;
  /** Most recent stock-movement photo for this lot — shown on the
   *  pickup directions screen so the worker can recognise the box
   *  at the shelf instead of just matching a label. */
  last_photo_url: string | null;
}

export interface ManufacturingOrderBookingCellSummary {
  id: number;
  uuid: string;
  name: string | null;
  purpose: string;
  /** Non-null on system cells (`unregistered` = receiving zone) — the
   *  pickup directions UI uses it to skip the floor plan + show a
   *  "find at receiving" hint instead, because system floors aren't
   *  laid out on the canvas. */
  system_kind?: string | null;
  /** 0-based shelf level inside the rack — when only `name` is null,
   *  the FE derives the label as `Level <ordinal+1>`. Set on payloads
   *  served from the warehouse-pickup detail endpoint; older callers
   *  may omit it. */
  ordinal?: number | null;
  /** Full breadcrumb when the BE preloaded the storage chain
   *  (warehouse-pickup detail + production_feed cells endpoints).
   *  Drives the directions card + FloorPlanMini in the pickup flow.
   *  `id` is only set when the row comes from a booking payload —
   *  the production_feed cells endpoint trims it. */
  storage_location?: {
    id?: number;
    uuid: string;
    name: string | null;
    code: string | null;
    floor: {
      id?: number;
      uuid: string;
      name: string | null;
      warehouse: { id?: number; uuid: string; name: string | null } | null;
    } | null;
  } | null;
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
  stock_lot_id: number | null;
  stock_lot: ManufacturingOrderBookingLotSummary | null;
  /** Placeholder booking — reserves qty against an open PO line that
   *  hasn't yet produced a stock lot. Mutually exclusive with
   *  `stock_lot_id`. Auto-upgrades to a real lot booking when the
   *  related PO is received + QC-passed. */
  purchase_order_line_id: number | null;
  purchase_order_line: BookingPurchaseOrderLine | null;
  storage_cell_id: number | null;
  storage_location: ManufacturingOrderBookingCellSummary | null;
  manufacturing_order_id: number;
  /** Set when the picker has scanned both the cell + lot and tapped
   *  Mark Picked. Lot is logically still at storage_cell until the
   *  final confirm-transfer emits the actual move movement. */
  picked_at: string | null;
  picked_by: AuditActor | null;
  /** Pre-production receipt sign-off. The production operator weighs
   *  / counts the lot at the production-feed cell and signs off; the
   *  MO can't transition to `in_progress` until every raw-material /
   *  packaging booking is received. */
  received_at: string | null;
  received_by: AuditActor | null;
  received_qty: string | null;
  received_notes: string | null;
  /** Production closeout — stamped once the operator has scanned the
   *  booked lot at the production-feed cell after the run, recorded
   *  consumption (0 = fully used), and (if any qty remains) handed
   *  the remainder to a production-side dispatch cell. */
  consumed_at: string | null;
  consumed_by: AuditActor | null;
  inserted_at: string;
  updated_at: string;
}

/** Placeholder-booking link to its parent PO line. Surfaces the PO
 *  code + expected delivery so the parts table can render
 *  "Expecting from PO00xxx · arriving 17 Jul" without a lookup. */
export interface BookingPurchaseOrderLine {
  id: number;
  uuid: string;
  qty_ordered: string;
  qty_received: string;
  expected_delivery_date: string | null;
  purchase_order: {
    id: number;
    uuid: string;
    code: string | null;
    status: string;
    expected_delivery_date: string | null;
  } | null;
}

/** Row of the production-closeout queue. Slim shape for the mobile
 *  list. */
export interface CloseoutQueueEntry {
  mo: ManufacturingOrderSummary;
  actual_finish: string | null;
  production_cell: {
    id: number;
    uuid: string;
    name: string | null;
  } | null;
}

/** Produced output lot still sitting at the production-feed cell —
 *  shaped like a booking row so the mobile flow can render them in
 *  one mixed list with the same scan / photo / qty pattern. */
export interface CloseoutOutputLot {
  id: number;
  uuid: string;
  code: string | null;
  qty_on_hand: string;
  status: string;
  item: BOMPartSummary | null;
  uom: { id: number; symbol: string; name: string } | null;
  current_cell: {
    id: number;
    uuid: string;
    name: string | null;
  } | null;
}

/** Production-side dispatch cell shown in the destination picker. */
export interface DispatchCell {
  id: number;
  uuid: string;
  name: string | null;
  ordinal: number | null;
  code: string;
  location: {
    id: number;
    uuid: string;
    name: string | null;
    code: string | null;
    floor: {
      id: number;
      uuid: string;
      name: string | null;
      warehouse: { id: number; uuid: string; name: string | null } | null;
    } | null;
  } | null;
}

/** Warehouse return-pickup queue card (Phase C). */
export interface ReturnPickupQueueEntry {
  mo: ManufacturingOrderSummary;
  actual_finish: string | null;
  lots_at_dispatch: number;
  production_cell: {
    id: number;
    uuid: string;
    name: string | null;
  } | null;
}

/** Lot sitting at a production-side dispatch cell, awaiting pickup. */
export interface ReturnPickupLot {
  id: number;
  uuid: string;
  code: string | null;
  status: string;
  qty_on_hand: string;
  item: BOMPartSummary | null;
  uom: { id: number; symbol: string; name: string } | null;
  source_kind: string;
  source_ref: string | null;
  last_photo_url: string | null;
  dispatch_cell: DispatchCell | null;
}

/** A warehouse worker's open trolley row — lot is off the dispatch
 *  cell logically but not yet placed at a warehouse rack. */
export interface ReturnPickRow {
  id: number;
  uuid: string;
  qty: string;
  picked_at: string;
  picked_photo_url: string | null;
  placed_at: string | null;
  placed_photo_url: string | null;
  stock_lot: {
    id: number;
    uuid: string;
    code: string | null;
    status: string;
    last_photo_url: string | null;
    item: BOMPartSummary | null;
    uom: { id: number; symbol: string; name: string } | null;
  } | null;
  picked_from_cell: {
    id: number;
    uuid: string;
    name: string | null;
    purpose: string | null;
  } | null;
  placed_to_cell: {
    id: number;
    uuid: string;
    name: string | null;
    purpose: string | null;
  } | null;
  picked_by: {
    id: number;
    uuid: string;
    name: string | null;
    email: string;
  } | null;
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
  /** Warehouse-pickup state. All four stamps null until the planner
   *  releases the MO. State projection:
   *    - released = released_to_warehouse_at != null
   *    - picking-in-progress = pickup_started_at != null && pickup_completed_at == null
   *    - handed-off = pickup_completed_at != null
   */
  released_to_warehouse_at: string | null;
  released_to_warehouse_by: AuditActor | null;
  /** Per-MO override for the picker visibility window in hours. Null
   *  falls back to company.default_pickup_window_hours. */
  pickup_window_hours: number | null;
  pickup_started_at: string | null;
  pickup_started_by: AuditActor | null;
  pickup_completed_at: string | null;
  pickup_completed_by: AuditActor | null;
  production_cell_id: number | null;
  /** Production-feed cell breadcrumb — set when the picker confirmed
   *  transfer. Drives the FloorPlanMini on the run detail page. */
  production_cell: {
    id: number;
    uuid: string;
    name: string | null;
    purpose: string;
    ordinal: number | null;
    system_kind: string | null;
    storage_location?: {
      id: number;
      uuid: string;
      name: string | null;
      code: string | null;
      floor: {
        id: number;
        uuid: string;
        name: string | null;
        warehouse: { id: number; uuid: string; name: string | null } | null;
      } | null;
    } | null;
  } | null;
  /** Production-run sign-off. Stamped by the operator hitting Start /
   *  Finish on the desktop /production/runs tab. `produced_lot_id`
   *  points at the auto-created output stock_lot. */
  actual_start: string | null;
  actual_finish: string | null;
  quantity_produced: string | null;
  produced_lot_id: number | null;
  /** Materials cost = sum(bom_line × MO qty × unit_cost). */
  approximate_cost: string | null;
  materials_cost: string | null;
  /** materials_cost / MO quantity. */
  cost_per_unit: string | null;
  parts: ManufacturingOrderPart[];
  operations: ManufacturingOrderOperation[];
  /** Bookings the system can no longer satisfy. Empty = clean.
   *  Non-empty = planner must pull back & re-book / spawn a child MO. */
  broken_bookings: BrokenBooking[];
  /** Same counts the schedule view sees — surfaced on the full MO
   *  so the detail page can render the same red badges + gate the
   *  Release button without an extra query. */
  broken_bookings_count: number;
  under_booked_count: number;
  /** Replan regression — set when the MO bounced back from
   *  scheduled/in-progress because something broke its plan. UI
   *  shows a banner with the reason + a "Mark replanned" CTA. */
  needs_replan: boolean;
  needs_replan_reason: string | null;
  needs_replan_at: string | null;
  /** Planner has marked this MO for procurement — bookings are
   *  locked, and the MO's shortages surface on the procurement
   *  Shortages page. Cleared when the MO is prepared (or explicitly
   *  cancelled by the planner). */
  purchasing_requested_at: string | null;
  purchasing_requested_by: AuditActor | null;
  created_by: AuditActor | null;
  updated_by: AuditActor | null;
  inserted_at: string;
  updated_at: string;
}

export interface BrokenBooking {
  booking_uuid: string;
  item_id: number;
  item_name: string;
  lot_uuid: string;
  lot_code: string | null;
  lot_status: string;
  /** "manufacturing_order" → produced by a previous MO. Pass-QC at
   *  /m/inspections or open the lot to record a Pass-QC event.
   *  "purchase_order" → received from a vendor. Goods-In Inspection.
   *  "opening_balance" → seeded; pass-QC by opening the lot.
   *  "manual" → manually-received; pass-QC by opening the lot. */
  lot_source_kind: string;
  lot_source_ref: string | null;
  /** Set when lot_source_kind = "manufacturing_order" — the upstream
   *  MO whose output this lot represents. Lets the UI deep-link to
   *  it ("from MO00017"). */
  producing_mo: {
    id: number;
    uuid: string;
    code: string | null;
    status: string;
  } | null;
  booked_qty: string;
  on_hand_qty: string;
  total_booked_qty: string;
  /** "lot_unavailable" (QC rejected / quarantine) or "over_allocated"
   *  (sum of bookings exceeds on-hand qty across all MOs). */
  reason: "lot_unavailable" | "over_allocated";
}

export interface UnderBookedLine {
  item_id: number;
  item_name: string;
  required: string;
  booked: string;
  short: string;
}

export interface LotOffWarehouseRow {
  booking_uuid: string;
  item_name: string;
  lot_uuid: string;
  /** Qty booked for this MO. */
  booked_qty: string;
  /** Qty currently in a `regular` warehouse cell. Less than booked
   *  means the rest is sitting at production_feed / dispatch and
   *  needs return-pickup back to a warehouse rack. */
  in_warehouse_qty: string;
}

export interface AwaitingChildLine {
  item_id: number;
  item_name: string;
  required: string;
  /** Real lot bookings only — does NOT include pending child output. */
  booked: string;
  /** required - booked. The qty the child MO must produce + QC to
   *  unblock release. */
  short: string;
  /** Open child MOs producing this item. Each one's planned qty
   *  contributes to closing the gap once it finishes + passes QC. */
  waiting_on_children: Array<{
    id: number;
    uuid: string;
    code: string | null;
    status: string;
    quantity: string;
  }>;
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
  /** Broken-booking count carried on the summary so list pages can
   *  render the warning chip without a full MO fetch. 0 = clean. */
  broken_bookings_count: number;
  /** Under-booked BOM lines (booked < required). Same warning chip. */
  under_booked_count: number;
  created_by: AuditActor | null;
  updated_by: AuditActor | null;
  inserted_at: string;
  updated_at: string;
}

/** Warehouse picker queue entry — one per released MO whose pickup
 *  window has opened and whose pickup isn't yet complete. */
export interface PickupQueueEntry {
  mo: ManufacturingOrderSummary;
  visible_from: string;
  pickup_by: string | null;
  window_hours: number;
  pickup_started_at: string | null;
  pickup_started_by: AuditActor | null;
  released_to_warehouse_at: string;
  released_to_warehouse_by_id: number | null;
}

/** Row of the production operator's preflight queue. Surfaces MOs
 *  whose warehouse pickup is complete (lots are at the production-feed
 *  cell) but the per-booking qty + quality sign-off is still pending. */
export interface PreflightQueueEntry {
  mo: ManufacturingOrderSummary;
  planned_start: string | null;
  pickup_completed_at: string | null;
  pickup_completed_by: AuditActor | null;
}

/** Row of the production output-QC queue — a manufactured stock_lot
 *  awaiting pass / fail sign-off before it transfers to the
 *  warehouse. */
export interface OutputQcEntry {
  lot: {
    id: number;
    uuid: string;
    code: string | null;
    qty_received: string;
    status: string;
    package_length_mm: number | null;
    package_width_mm: number | null;
    package_height_mm: number | null;
    package_weight_kg: string | null;
    units_per_package: string | null;
    stack_factor: number | null;
    received_at: string | null;
    item: BOMPartSummary | null;
    uom: { id: number; symbol: string; name: string } | null;
    production_cell: {
      id: number;
      uuid: string;
      name: string | null;
      storage_location: {
        code: string | null;
        name: string | null;
        floor: {
          name: string | null;
          warehouse: { name: string | null } | null;
        } | null;
      } | null;
    } | null;
  };
  mo: {
    id: number;
    uuid: string;
    code: string | null;
    item: BOMPartSummary | null;
    quantity: string;
    quantity_produced: string | null;
    actual_finish: string | null;
    pickup_completed_by: AuditActor | null;
  } | null;
}

/** Row of the production-run queue. Preflight-cleared MOs ready to
 *  Start or actively in_progress. */
export interface ProductionRunEntry {
  mo: ManufacturingOrderSummary;
  planned_start: string | null;
  planned_finish: string | null;
  actual_start: string | null;
  actual_finish: string | null;
  quantity_produced: string | null;
  pickup_completed_at: string | null;
  pickup_completed_by: AuditActor | null;
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
