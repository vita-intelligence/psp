defmodule Backend.Repo.Migrations.CreateEquipmentCategories do
  @moduledoc """
  Asset category master — a grouping label ("Machinery", "IT
  Equipment", "Vehicles", "Lab Instruments") that carries the
  operator-facing defaults for its members: useful life, calibration
  cadence, maintenance cadence. When an equipment row is created
  with a `category_id`, its own cadence + life columns fill in from
  the category unless the operator overrides them.

  Modelled on ERPNext's Asset Category minus the accounting
  side (depreciation account, capital work-in-progress account,
  fixed-asset account). PSP has no GL today, so those go on a
  follow-up when depreciation math lands.
  """

  use Ecto.Migration

  def change do
    create table(:equipment_categories) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies, on_delete: :restrict), null: false

      add :name, :string, size: 120, null: false
      add :notes, :text
      add :is_active, :boolean, null: false, default: true

      # Operator defaults propagated to new equipment. Nullable so a
      # category can carry only the subset of defaults that make
      # sense for it (a "Laptops" category doesn't need calibration).
      add :default_useful_life_years, :integer
      add :default_calibration_frequency_months, :integer
      add :default_maintenance_frequency_months, :integer

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)
      timestamps(type: :utc_datetime)
    end

    create unique_index(:equipment_categories, [:company_id, :name])
    create unique_index(:equipment_categories, [:uuid])

    alter table(:equipment) do
      add :category_id, references(:equipment_categories, on_delete: :nilify_all)
    end

    create index(:equipment, [:category_id])
  end
end
