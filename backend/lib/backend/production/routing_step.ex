defmodule Backend.Production.RoutingStep do
  @moduledoc """
  One operation on a routing. Carries the workstation group it runs
  on, free-text operation description, setup + cycle times (in
  minutes), fixed + variable costs (in the company base currency),
  capacity, and zero-or-more default workers via the
  `routing_step_workers` M2M.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Companies.Company
  alias Backend.Production.{Routing, RoutingStepWorker, WorkstationGroup}

  schema "routing_steps" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :sort_order, :integer, default: 0
    field :operation_description, :string

    field :setup_time_min, :decimal
    field :cycle_time_min, :decimal
    field :fixed_cost, :decimal
    field :variable_cost, :decimal
    field :capacity, :decimal, default: Decimal.new("1.0")

    belongs_to :company, Company
    belongs_to :routing, Routing
    belongs_to :workstation_group, WorkstationGroup

    has_many :worker_assignments, RoutingStepWorker,
      foreign_key: :routing_step_id,
      preload_order: [asc: :id]

    has_many :workers, through: [:worker_assignments, :user]

    timestamps(type: :utc_datetime)
  end

  def changeset(step, attrs) do
    step
    |> cast(attrs, [
      :company_id,
      :routing_id,
      :workstation_group_id,
      :sort_order,
      :operation_description,
      :setup_time_min,
      :cycle_time_min,
      :fixed_cost,
      :variable_cost,
      :capacity
    ])
    |> validate_required([:company_id, :workstation_group_id])
    |> validate_length(:operation_description, max: 2000)
    |> validate_number(:capacity, greater_than: 0)
    |> validate_non_negative(:setup_time_min)
    |> validate_non_negative(:cycle_time_min)
    |> validate_non_negative(:fixed_cost)
    |> validate_non_negative(:variable_cost)
    |> assoc_constraint(:company)
    |> assoc_constraint(:routing)
    |> assoc_constraint(:workstation_group)
    |> check_constraint(:capacity,
      name: :routing_steps_capacity_positive,
      message: "must be greater than zero"
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
end
