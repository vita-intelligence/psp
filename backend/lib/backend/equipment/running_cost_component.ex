defmodule Backend.Equipment.RunningCostComponent do
  @moduledoc """
  One line item in an equipment unit's hourly running-cost stack.
  Deliberately generic — an operator can add electricity,
  compressed air, consumables, maintenance reserve, software
  licence, etc. — one row per cost driver, all summed by the
  ``RunningCosts`` context into ``equipment.hourly_running_cost``.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Equipment.Equipment

  schema "equipment_running_cost_components" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :label, :string
    field :amount_per_hour, :decimal
    field :currency, :string
    field :notes, :string
    field :is_active, :boolean, default: true

    belongs_to :company, Company
    belongs_to :equipment, Equipment
    belongs_to :created_by, User
    belongs_to :updated_by, User

    timestamps(type: :utc_datetime)
  end

  def changeset(component, attrs) do
    component
    |> cast(attrs, [
      :company_id,
      :equipment_id,
      :label,
      :amount_per_hour,
      :currency,
      :notes,
      :is_active,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:company_id, :equipment_id, :label, :amount_per_hour])
    |> validate_length(:label, min: 1, max: 120)
    |> validate_length(:currency, is: 3)
    |> validate_number(:amount_per_hour, greater_than_or_equal_to: 0)
  end
end
