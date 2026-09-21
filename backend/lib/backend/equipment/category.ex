defmodule Backend.Equipment.Category do
  @moduledoc """
  Asset-category master. See migration doc for the "why".

  Categories carry operator-facing defaults for their members:
  useful life + calibration cadence + maintenance cadence. New
  equipment inherits any non-null default from its category — the
  operator can still override on the equipment row itself.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company

  schema "equipment_categories" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :name, :string
    field :notes, :string
    field :is_active, :boolean, default: true

    field :default_useful_life_years, :integer
    field :default_calibration_frequency_months, :integer
    field :default_maintenance_frequency_months, :integer

    belongs_to :company, Company
    belongs_to :created_by, User
    belongs_to :updated_by, User

    # Form templates attached to every equipment in this category.
    # Kiosk pulls these on an equipment-scoped cleaning / maintenance
    # session so all V-blenders share one CIP checklist.
    has_many :form_assignments,
             Backend.Equipment.CategoryFormAssignment,
             foreign_key: :equipment_category_id,
             preload_order: [asc: :slot, asc: :sort_order, asc: :id]

    timestamps(type: :utc_datetime)
  end

  def changeset(struct, attrs) do
    struct
    |> cast(attrs, [
      :company_id,
      :name,
      :notes,
      :is_active,
      :default_useful_life_years,
      :default_calibration_frequency_months,
      :default_maintenance_frequency_months,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:company_id, :name])
    |> validate_length(:name, min: 1, max: 120)
    |> validate_number(:default_useful_life_years, greater_than: 0, less_than: 100)
    |> validate_number(:default_calibration_frequency_months,
      greater_than: 0,
      less_than_or_equal_to: 120
    )
    |> validate_number(:default_maintenance_frequency_months,
      greater_than: 0,
      less_than_or_equal_to: 120
    )
    |> unique_constraint([:company_id, :name],
      name: :equipment_categories_company_id_name_index,
      message: "already exists for this company"
    )
  end
end
