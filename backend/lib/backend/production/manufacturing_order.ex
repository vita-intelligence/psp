defmodule Backend.Production.ManufacturingOrder do
  @moduledoc """
  Manufacturing order schema. The status field is the single source
  of truth for where the order sits on the floor:

    * `draft` — operator is still building it. Free to edit.
    * `prepared` — 1st signature (planner).
    * `approved` — 2nd signature (scientist). The MO is committed
      but not yet on the calendar — it sits in the scheduler's
      backlog.
    * `scheduled` — derived from steps: every step has a
      `planned_start`. Set automatically when the planner drags
      the MO onto the calendar, cleared when they drag it back
      to the backlog.
    * `in_progress` — operators have started running it.
    * `completed` — output lot is in the system.
    * `cancelled` — aborted; no stock effect.

  Timing intentionally lives on the steps, NOT on the MO.
  Approval is about WHAT we're making (item, qty, BOM, routing);
  scheduling is about WHEN. The two are separate workflow phases.

  Transitions are gated server-side. See
  `Backend.Production.transition_mo/3` for the allowed pairs.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Items.Item
  alias Backend.Production.{
    BOM,
    ManufacturingOrderBooking,
    ManufacturingOrderStep,
    MOConsumerLink,
    Routing
  }

  alias Backend.Warehouses.Warehouse

  @statuses ~w(draft prepared approved scheduled in_progress completed cancelled)
  def statuses, do: @statuses

  schema "manufacturing_orders" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :quantity, :decimal
    field :due_date, :date
    field :expiry_date, :date

    field :revision, :string, default: "V00"
    field :status, :string, default: "draft"

    field :approved_at, :utc_datetime
    field :prepared_at, :utc_datetime
    field :rejection_reason, :string
    field :notes, :string

    # Replan regression — set when an MO that's already past
    # `approved` is bounced back because something broke its plan
    # (Output QC fail, peer MO over-consumed a booked lot, lot
    # rejected after release). When true, the MO renders as "Needs
    # replan" and `release_mo_to_warehouse` refuses until the
    # planner re-confirms the bookings via `clear_replan/2`.
    field :needs_replan, :boolean, default: false
    field :needs_replan_reason, :string
    field :needs_replan_at, :utc_datetime

    # Procurement request gate. While set, the MO is in "Purchasing"
    # mode — existing bookings are locked and the shortages page
    # surfaces this MO's unbooked items to procurement.
    field :purchasing_requested_at, :utc_datetime

    # Warehouse pickup workflow. The planner releases a scheduled MO
    # to the warehouse; the picker walks the bookings, scans each lot
    # at its cell, then transfers the load to a production_feed cell.
    # State is column-derived — see migration 20260618200000 for the
    # projected-state matrix.
    field :released_to_warehouse_at, :utc_datetime
    field :pickup_window_hours, :integer
    field :pickup_started_at, :utc_datetime
    field :pickup_completed_at, :utc_datetime

    # Production-run sign-off. Set by the operator hitting Start (now)
    # and Finish (date/time + actual produced qty). `produced_lot_id`
    # points at the auto-created output stock_lot that lands at the
    # production-feed cell pending the post-production return.
    field :actual_start, :utc_datetime
    field :actual_finish, :utc_datetime
    field :quantity_produced, :decimal

    # Virtual — count of raw_material / packaging bookings whose lot is
    # not yet "available" (i.e. still in quarantine / received, awaiting
    # Goods-In Inspection). Populated by Production.with_qc_pending_count
    # so the planner sees QC progress on the calendar block + edit
    # dialog before clicking Release. Not persisted.
    field :qc_pending_count, :integer, virtual: true, default: 0

    # Virtual — count of bookings whose lot can no longer satisfy
    # them: lot status fell out of `available` (QC rejected /
    # quarantine / hold) OR lot is over-allocated (sum of bookings
    # exceeds the on-hand qty, e.g. a peer MO consumed more than
    # expected). Populated by Production.list_schedule_operations +
    # mo_broken_bookings_payload. Drives the "Bookings need attention"
    # banner + picker-queue warning. Not persisted.
    field :broken_bookings_count, :integer, virtual: true, default: 0

    # Virtual — count of BOM lines that aren't fully covered by
    # bookings (sum of `requested` bookings < required qty). Catches
    # under-booked MOs that slipped through before the release-time
    # `ensure_all_lines_fully_booked` gate existed. Drives the same
    # calendar warning chip as broken_bookings_count.
    field :under_booked_count, :integer, virtual: true, default: 0

    belongs_to :company, Company
    belongs_to :warehouse, Warehouse
    belongs_to :item, Item
    belongs_to :bom, BOM
    belongs_to :routing, Routing
    belongs_to :assigned_to, User
    belongs_to :approved_by, User
    belongs_to :prepared_by, User
    belongs_to :released_to_warehouse_by, User
    belongs_to :pickup_started_by, User
    belongs_to :pickup_completed_by, User
    belongs_to :purchasing_requested_by, User
    belongs_to :production_cell, Backend.Warehouses.StorageCell
    belongs_to :produced_lot, Backend.Stock.Lot
    belongs_to :customer_order_line, Backend.CustomerOrders.CustomerOrderLine
    belongs_to :created_by, User
    belongs_to :updated_by, User

    # Parent / child chain. FG MO whose BOM needs a semi-finished
    # the stock can't cover auto-spawns one child MO per shortfall.
    # The child's `parent_mo_id` points back here.
    belongs_to :parent_mo, __MODULE__, foreign_key: :parent_mo_id

    has_many :children, __MODULE__,
      foreign_key: :parent_mo_id,
      preload_order: [asc: :inserted_at]

    has_many :steps, ManufacturingOrderStep,
      foreign_key: :manufacturing_order_id,
      preload_order: [asc: :sort_order]

    has_many :bookings, ManufacturingOrderBooking,
      foreign_key: :manufacturing_order_id,
      preload_order: [asc: :item_id, asc: :id]

    # This MO acts as a shared batch — these links point at the
    # additional consumer MOs it feeds (the primary parent stays
    # on parent_mo_id).
    has_many :consumer_links, MOConsumerLink,
      foreign_key: :batch_mo_id,
      preload_order: [asc: :inserted_at]

    # This MO is a consumer — these links point at the batch MO(s)
    # that supply it via shared-batch merge.
    has_many :supplier_links, MOConsumerLink,
      foreign_key: :consumer_mo_id,
      preload_order: [asc: :inserted_at]

    timestamps(type: :utc_datetime)
  end

  @doc """
  Form changeset — what the operator can change on create / edit.
  Status flips live on `transition_changeset/2` so they go through
  the explicit transition path with their own audit event.
  """
  def changeset(mo, attrs) do
    mo
    |> cast(attrs, [
      :company_id,
      :warehouse_id,
      :item_id,
      :bom_id,
      :routing_id,
      :parent_mo_id,
      :customer_order_line_id,
      :quantity,
      :due_date,
      :expiry_date,
      :assigned_to_id,
      :revision,
      :notes,
      :pickup_window_hours,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([
      :company_id,
      :warehouse_id,
      :item_id,
      :bom_id,
      :quantity,
      :assigned_to_id
    ])
    |> validate_length(:revision, max: 16)
    |> validate_length(:notes, max: 4000)
    |> validate_number(:quantity, greater_than: 0)
    |> validate_number(:pickup_window_hours, greater_than: 0)
    |> assoc_constraint(:company)
    |> assoc_constraint(:warehouse)
    |> assoc_constraint(:item)
    |> assoc_constraint(:bom)
    |> assoc_constraint(:routing)
    |> assoc_constraint(:assigned_to)
    |> check_constraint(:quantity,
      name: :manufacturing_orders_quantity_positive,
      message: "must be greater than zero"
    )
  end

  @doc """
  Status-only changeset — fed by `transition_mo/3` after the
  context layer has validated the transition is allowed. Avoids
  re-running the form-level required checks on transitions.
  """
  def transition_changeset(mo, attrs) do
    mo
    |> cast(attrs, [
      :status,
      :approved_at,
      :approved_by_id,
      :prepared_at,
      :prepared_by_id,
      :rejection_reason,
      :needs_replan,
      :needs_replan_reason,
      :needs_replan_at,
      :purchasing_requested_at,
      :purchasing_requested_by_id,
      :updated_by_id
    ])
    |> validate_inclusion(:status, @statuses)
    |> validate_length(:rejection_reason, max: 2_000)
    |> validate_length(:needs_replan_reason, max: 2_000)
    |> check_constraint(:status,
      name: :manufacturing_orders_status_known,
      message: "must be a known status"
    )
  end

  @doc """
  Warehouse-pickup state changeset. Stamps the release / start-pickup
  / abort-pickup / confirm-transfer timestamps without re-running the
  form-level required checks (since these flows don't touch the MO
  identity fields).
  """
  def pickup_changeset(mo, attrs) do
    mo
    |> cast(attrs, [
      :status,
      :released_to_warehouse_at,
      :released_to_warehouse_by_id,
      :pickup_window_hours,
      :pickup_started_at,
      :pickup_started_by_id,
      :pickup_completed_at,
      :pickup_completed_by_id,
      :production_cell_id,
      :updated_by_id
    ])
    |> validate_number(:pickup_window_hours, greater_than: 0)
    |> check_constraint(:pickup_window_hours,
      name: :mo_pickup_window_positive,
      message: "must be greater than zero"
    )
  end

  @doc """
  Production-run sign-off changeset. Stamps Start (actual_start +
  status transition to in_progress) and Finish (actual_finish +
  quantity_produced + produced_lot_id + status → completed) without
  re-validating the form-level identity fields — the run flow only
  touches operator-stamped columns.
  """
  def run_changeset(mo, attrs) do
    mo
    |> cast(attrs, [
      :status,
      :actual_start,
      :actual_finish,
      :quantity_produced,
      :produced_lot_id,
      :updated_by_id
    ])
    |> validate_number(:quantity_produced, greater_than_or_equal_to: 0)
    |> check_constraint(:quantity_produced,
      name: :mo_quantity_produced_non_negative,
      message: "must be zero or greater"
    )
    |> check_constraint(:actual_finish,
      name: :mo_actual_finish_after_start,
      message: "must be on or after actual_start"
    )
  end
end
