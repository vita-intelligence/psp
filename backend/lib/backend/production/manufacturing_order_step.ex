defmodule Backend.Production.ManufacturingOrderStep do
  @moduledoc """
  Per-MO operation row — the live instance of a routing template
  step. Carries the description override, planned + actual times,
  applied overhead, labor cost, and assigned workers.

  Snapshotted from `RoutingStep` when the MO is created; edits to
  the template never bleed back into in-flight MOs.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company

  alias Backend.Production.{
    ManufacturingOrder,
    ManufacturingOrderStepWorker,
    RoutingStep,
    WorkstationGroup
  }

  schema "manufacturing_order_steps" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :sort_order, :integer, default: 0
    field :operation_description, :string

    field :setup_time_min, :decimal
    field :cycle_time_min, :decimal
    field :fixed_cost, :decimal
    field :variable_cost, :decimal
    field :capacity, :decimal, default: Decimal.new("1.0")

    field :planned_start, :utc_datetime
    field :planned_finish, :utc_datetime
    field :actual_start, :utc_datetime
    field :actual_finish, :utc_datetime

    field :applied_overhead_cost, :decimal
    field :labor_cost, :decimal
    field :quantity, :decimal

    field :notes, :string

    belongs_to :company, Company
    belongs_to :manufacturing_order, ManufacturingOrder
    belongs_to :workstation_group, WorkstationGroup
    belongs_to :routing_step, RoutingStep
    belongs_to :created_by, User
    belongs_to :updated_by, User

    has_many :worker_assignments, ManufacturingOrderStepWorker,
      foreign_key: :manufacturing_order_step_id,
      preload_order: [asc: :id]

    has_many :workers, through: [:worker_assignments, :user]

    timestamps(type: :utc_datetime)
  end

  @cast_fields ~w(
    company_id manufacturing_order_id workstation_group_id routing_step_id
    sort_order operation_description
    setup_time_min cycle_time_min fixed_cost variable_cost capacity
    planned_start planned_finish actual_start actual_finish
    applied_overhead_cost labor_cost quantity notes
    created_by_id updated_by_id
  )a

  def changeset(step, attrs) do
    step
    |> cast(attrs, @cast_fields)
    |> validate_required([
      :company_id,
      :manufacturing_order_id,
      :workstation_group_id
    ])
    |> validate_length(:operation_description, max: 10_000)
    |> validate_length(:notes, max: 4_000)
    |> validate_number(:capacity, greater_than: 0)
    |> validate_non_negative(:setup_time_min)
    |> validate_non_negative(:cycle_time_min)
    |> validate_non_negative(:fixed_cost)
    |> validate_non_negative(:variable_cost)
    |> validate_non_negative(:applied_overhead_cost)
    |> validate_non_negative(:labor_cost)
    |> validate_non_negative(:quantity)
    |> validate_actual_order()
    |> assoc_constraint(:company)
    |> assoc_constraint(:manufacturing_order)
    |> assoc_constraint(:workstation_group)
    |> assoc_constraint(:routing_step)
    |> check_constraint(:capacity,
      name: :mo_steps_capacity_positive,
      message: "must be greater than zero"
    )
    |> check_constraint(:actual_finish,
      name: :mo_steps_actual_order,
      message: "must be on or after actual_start"
    )
  end

  defp validate_non_negative(cs, field) do
    case get_field(cs, field) do
      nil ->
        cs

      %Decimal{} = d ->
        if Decimal.compare(d, Decimal.new("0")) == :lt do
          add_error(cs, field, "must be zero or greater")
        else
          cs
        end

      n when is_number(n) and n < 0 ->
        add_error(cs, field, "must be zero or greater")

      _ ->
        cs
    end
  end

  defp validate_actual_order(cs) do
    case {get_field(cs, :actual_start), get_field(cs, :actual_finish)} do
      {%DateTime{} = s, %DateTime{} = f} ->
        if DateTime.compare(f, s) == :lt do
          add_error(cs, :actual_finish, "must be on or after the actual start")
        else
          cs
        end

      _ ->
        cs
    end
  end
end
