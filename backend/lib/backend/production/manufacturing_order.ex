defmodule Backend.Production.ManufacturingOrder do
  @moduledoc """
  Manufacturing order schema. The status field is the single source
  of truth for where the order sits on the floor:

    * `draft` — operator is still building it. Free to edit.
    * `approved` — the approver has signed off; schedule reserves
      capacity. Header is mostly frozen (quantity / dates change
      via amend).
    * `in_progress` — operators have started running it.
    * `completed` — output lot is in the system (stock effect lands
      in a future pass; today this is just a status flip).
    * `cancelled` — aborted; no stock effect.

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
    Routing
  }

  alias Backend.Warehouses.Warehouse

  @statuses ~w(draft approved in_progress completed cancelled)
  def statuses, do: @statuses

  schema "manufacturing_orders" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :quantity, :decimal
    field :due_date, :date
    field :start_at, :utc_datetime
    field :finish_at, :utc_datetime
    field :expiry_date, :date

    field :revision, :string, default: "V00"
    field :status, :string, default: "draft"

    field :approved_at, :utc_datetime
    field :notes, :string

    belongs_to :company, Company
    belongs_to :warehouse, Warehouse
    belongs_to :item, Item
    belongs_to :bom, BOM
    belongs_to :routing, Routing
    belongs_to :assigned_to, User
    belongs_to :approved_by, User
    belongs_to :created_by, User
    belongs_to :updated_by, User

    has_many :steps, ManufacturingOrderStep,
      foreign_key: :manufacturing_order_id,
      preload_order: [asc: :sort_order]

    has_many :bookings, ManufacturingOrderBooking,
      foreign_key: :manufacturing_order_id,
      preload_order: [asc: :item_id, asc: :id]

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
      :quantity,
      :due_date,
      :start_at,
      :finish_at,
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
      :start_at,
      :finish_at,
      :assigned_to_id
    ])
    |> validate_length(:revision, max: 16)
    |> validate_length(:notes, max: 4000)
    |> validate_number(:quantity, greater_than: 0)
    |> validate_finish_after_start()
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
    |> check_constraint(:finish_at,
      name: :manufacturing_orders_finish_after_start,
      message: "must be on or after the start"
    )
  end

  @doc """
  Status-only changeset — fed by `transition_mo/3` after the
  context layer has validated the transition is allowed. Avoids
  re-running the form-level required checks on transitions.
  """
  def transition_changeset(mo, attrs) do
    mo
    |> cast(attrs, [:status, :approved_at, :approved_by_id, :updated_by_id])
    |> validate_inclusion(:status, @statuses)
    |> check_constraint(:status,
      name: :manufacturing_orders_status_known,
      message: "must be a known status"
    )
  end

  defp validate_finish_after_start(cs) do
    start_at = get_field(cs, :start_at)
    finish_at = get_field(cs, :finish_at)

    cond do
      is_nil(start_at) or is_nil(finish_at) ->
        cs

      DateTime.compare(finish_at, start_at) == :lt ->
        add_error(cs, :finish_at, "must be on or after the start")

      true ->
        cs
    end
  end
end
