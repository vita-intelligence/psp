defmodule Backend.Repo.Migrations.CreateItemRawMaterialCompliance do
  use Ecto.Migration

  @moduledoc """
  Regulatory + sourcing metadata for raw-material items. 1:1 with
  `items` (where `item_type = "raw_material"`), keyed on item_id so
  cascade-delete propagates from the parent.

  Universal enums (vegan/halal/kosher/organic/novel_food/gmo/allergen
  status) live as first-class columns so reports stay fast and FK-able
  constraints catch typos. Per-tenant rare metadata goes on
  `items.attributes` instead, via AttributeDefinitions.

  Tracker columns for the review cadence:
    * `last_reviewed_at` — when QA last signed off
    * `review_frequency_months` — admin-set cadence
    * `review_due_at` — computed (`last_reviewed_at + frequency`),
      indexed for the "reviews due in 30d" queue (Slice 7).

  Supplier link is deliberately omitted — suppliers don't exist yet
  in PSP. Added when they land (no vestigial FK).
  """

  def change do
    create table(:item_raw_material_compliance, primary_key: false) do
      add :item_id, references(:items, on_delete: :delete_all),
        primary_key: true,
        null: false

      # Functional classification within the formulation.
      # Drives BOM line role (Active vs Excipient).
      add :use_as, :string, size: 30

      # Allergen / dietary status. NULL = "not assessed yet".
      add :allergen_status, :string, size: 24
      add :vegan_status, :string, size: 20
      add :halal_status, :string, size: 24
      add :kosher_status, :string, size: 24
      add :organic_status, :string, size: 24

      # Regulatory status.
      add :novel_food_status, :string, size: 24
      add :gmo_status, :string, size: 16

      # ISO 3166-1 alpha-2.
      add :country_of_origin, :string, size: 2

      # Numeric specification.
      add :purity_pct, :decimal, precision: 5, scale: 2
      add :extract_ratio, :string, size: 20
      add :overage_pct, :decimal, precision: 5, scale: 2
      add :powder_water_dose_mg_per_ml, :decimal, precision: 10, scale: 3

      # Sourcing.
      add :shelf_life_months, :integer
      add :storage_conditions, :text
      add :spec_document_url, :text

      # Review cadence — indexed for the queue.
      add :last_reviewed_at, :utc_datetime
      add :last_reviewed_by_id, references(:users, on_delete: :nilify_all)
      add :review_frequency_months, :integer
      add :review_due_at, :date

      timestamps(type: :utc_datetime)
    end

    # Drives the "reviews due in 30d" queue.
    create index(:item_raw_material_compliance, [:review_due_at])
    create index(:item_raw_material_compliance, [:allergen_status])
    create index(:item_raw_material_compliance, [:organic_status])
  end
end
