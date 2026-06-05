defmodule Backend.Repo.Migrations.CreateItems do
  use Ecto.Migration

  @moduledoc """
  Core stock item — the parent row that per-type compliance subtables
  hang off of. Item_type acts as a discriminator: every item has
  exactly one of `item_raw_material_compliance` /
  `item_finished_product_spec` / `item_packaging_compliance` joined
  1:1 by item_id, written by the context.

  Regulatory + spec data lives in the subtables; this row keeps
  identity (name, type, family, stock UoM, supplier-facing identifiers)
  plus the AttributeDefinition-driven `attributes` bag for ad-hoc
  per-tenant metadata.

  Display code is rendered from id + numbering format on payload time
  (no stored column) per the standing PSP recipe.
  """

  def change do
    create table(:items) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies), null: false

      add :name, :string, null: false, size: 200
      add :description, :text

      # Discriminator. Drives which 1:1 compliance subtable is valid
      # and which AttributeDefinitions render in the FE form.
      add :item_type, :string, null: false, size: 32

      # Free-text external code (supplier catalog id, customer SKU, etc.).
      # Distinct from our rendered `code` — that one's derived from the
      # PK and the company numbering format.
      add :external_sku, :string, size: 80
      add :barcode, :string, size: 24

      # The unit the row is held in stock as. Stock movements,
      # min-stock, MOQ, BOM lines — all anchored to this UoM.
      add :stock_uom_id, references(:units_of_measurement, on_delete: :restrict)

      add :product_family_id, references(:product_families, on_delete: :nilify_all)

      # Free-form per-tenant extension fields, validated by the
      # context against `attribute_definitions` for this item_type.
      add :attributes, :jsonb, null: false, default: "{}"

      add :is_active, :boolean, null: false, default: true

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:items, [:uuid])
    create unique_index(:items, [:company_id, :name])
    # Optional: prevent the same external_sku from being used twice
    # within a company (skipping NULLs). Suppliers' codes collide
    # across companies, so this is per-tenant.
    create unique_index(:items, [:company_id, :external_sku],
             where: "external_sku IS NOT NULL"
           )
    create index(:items, [:company_id, :item_type, :is_active])
    create index(:items, [:product_family_id])
    create index(:items, [:stock_uom_id])
  end
end
