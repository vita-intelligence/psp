defmodule Backend.Repo.Migrations.CreateBoms do
  use Ecto.Migration

  # Bill of Materials — the recipe for one manufactured item.
  #
  # Multi-BOM per item: an item can carry several named BOMs (variant
  # recipes, "allergen-free" alt, factory-A vs factory-B, etc.) with
  # exactly one flagged `is_primary` at a time. The primary flag is
  # what manufacturing-orders read by default; the others stay
  # selectable by code in the MO create form.
  def change do
    create table(:boms) do
      add :uuid, :uuid, null: false
      add :name, :string, size: 200, null: false
      add :notes, :text
      add :is_primary, :boolean, default: false, null: false
      add :is_active, :boolean, default: true, null: false

      add :company_id, references(:companies, on_delete: :restrict), null: false
      # Output item — the thing this recipe builds. Restrict on delete
      # because losing the item silently would orphan every MO that
      # ever ran against it; cascade would be even worse.
      add :item_id, references(:items, on_delete: :restrict), null: false
      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:boms, [:uuid])
    create index(:boms, [:company_id])
    create index(:boms, [:item_id])

    # Postgres partial unique index — only one row per item can claim
    # `is_primary = true`. Lets us flip the flag cleanly: clear the
    # old primary, set the new one, commit.
    create unique_index(:boms, [:item_id],
             where: "is_primary = true",
             name: :boms_one_primary_per_item_index
           )

    create table(:bom_lines) do
      add :uuid, :uuid, null: false
      add :sort_order, :integer, default: 0, null: false
      add :qty, :decimal, precision: 14, scale: 4, null: false
      # Optional override of the part's stock UoM. Most BOMs use the
      # part's default; the column lets a recipe call out e.g. "grams"
      # against a kilogram-base material. NULL = inherit from the
      # part's stock UoM at consumption time.
      add :unit_of_measurement_id, references(:units_of_measurement, on_delete: :restrict)
      # Fixed quantity overrides the per-unit calc when the recipe
      # has a flat overhead independent of batch size (e.g. one
      # cleaning swab per batch regardless of qty produced).
      add :is_fixed, :boolean, default: false, null: false
      add :notes, :text

      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :bom_id, references(:boms, on_delete: :delete_all), null: false
      add :part_id, references(:items, on_delete: :restrict), null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:bom_lines, [:uuid])
    create index(:bom_lines, [:bom_id])
    create index(:bom_lines, [:part_id])
    # One row per (bom, part) — repeating a part on the same recipe
    # is a data-entry error; the operator should bump the qty instead.
    create unique_index(:bom_lines, [:bom_id, :part_id],
             name: :bom_lines_bom_part_index
           )
  end
end
