defmodule Backend.Repo.Migrations.CreateUnitsOfMeasurement do
  use Ecto.Migration

  def change do
    create table(:units_of_measurement) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies), null: false

      # Human label shown in the picker (e.g. "Kilogram").
      add :name, :string, null: false, size: 60

      # Short symbol shown in numeric contexts (e.g. "kg").
      add :symbol, :string, null: false, size: 12

      # Hard-coded enum: mass / volume / count / length / area / time.
      # Conversion is single-multiply within a dimension — no graph.
      add :dimension, :string, null: false, size: 16

      # `1 unit = factor_to_base * base_unit_of_this_dimension`.
      # Base unit has factor 1.000000. Precision 18, scale 9 keeps
      # mg-to-tonne ratios precise without floating-point drift.
      add :factor_to_base, :decimal, null: false, precision: 18, scale: 9

      # Exactly one base unit per (company_id, dimension). Enforced
      # at the application layer (changeset); a partial unique index
      # below also covers the DB invariant.
      add :is_base, :boolean, null: false, default: false

      add :is_active, :boolean, null: false, default: true

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:units_of_measurement, [:company_id, :symbol])
    create unique_index(:units_of_measurement, [:company_id, :name])
    create unique_index(:units_of_measurement, [:uuid])
    create index(:units_of_measurement, [:company_id, :dimension])

    # One base unit per (company, dimension). Partial index — only
    # rows where is_base=true are considered.
    create unique_index(
             :units_of_measurement,
             [:company_id, :dimension],
             where: "is_base = true",
             name: :units_of_measurement_one_base_per_dimension
           )
  end
end
