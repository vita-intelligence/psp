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

    belongs_to :company, Company
    belongs_to :warehouse, Warehouse
    belongs_to :item, Item
    belongs_to :bom, BOM
    belongs_to :routing, Routing
    belongs_to :assigned_to, User
    belongs_to :approved_by, User
    belongs_to :prepared_by, User
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
      :quantity,
      :due_date,
      :expiry_date,
      :assigned_to_id,
      :revision,
      :notes,
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
      :updated_by_id
    ])
    |> validate_inclusion(:status, @statuses)
    |> validate_length(:rejection_reason, max: 2_000)
    |> check_constraint(:status,
      name: :manufacturing_orders_status_known,
      message: "must be a known status"
    )
  end

end
