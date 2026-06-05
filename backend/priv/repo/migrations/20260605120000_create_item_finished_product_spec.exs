defmodule Backend.Repo.Migrations.CreateItemFinishedProductSpec do
  use Ecto.Migration

  @moduledoc """
  Finished-product specification — 1:1 with `items` (where
  `item_type = "finished_product"`). Carries the regulator-facing
  identity (claims, nutrition, contaminant limits, dosage).

  Two JSONB bags here are structurally non-trivial:

    * `active_claims` — [{ claim_register_uuid, mg_per_serving,
      nrv_pct }, ...] — per-active label claim that references the
      regulator register rather than denormalising the text.
    * `nutrition_table` — per-100g + per-serving + NRV% structured
      payload. Shape is regulator-driven; locked at write-time via the
      context.
    * `contaminant_limits_overrides` — micro/PAH/heavy metals limits
      that override the company default. Same shape as
      `companies.default_spec_limits`. Merged at read-time by the
      payload shaper.

  `may_contain_*` columns hold the cross-contamination warning with
  a separate audit trail — regulators require the *reason* the
  warning is needed, not just the warning itself.
  """

  def change do
    create table(:item_finished_product_spec, primary_key: false) do
      add :item_id, references(:items, on_delete: :delete_all),
        primary_key: true,
        null: false

      add :regulatory_category, :string, size: 32
      add :dosage_form, :string, size: 24

      add :capsule_size, :string, size: 8
      add :tablet_size_mm, :decimal, precision: 5, scale: 2
      add :powder_type, :string, size: 16

      add :serving_size, :decimal, precision: 10, scale: 3
      add :serving_size_uom_id, references(:units_of_measurement, on_delete: :restrict)
      add :servings_per_pack, :integer
      add :net_quantity, :decimal, precision: 10, scale: 3
      add :net_quantity_uom_id, references(:units_of_measurement, on_delete: :restrict)

      add :directions_of_use, :text
      add :suggested_dosage, :text
      add :warnings_text, :text
      add :appearance, :text
      add :disintegration_spec, :text
      add :weight_uniformity_pct, :decimal, precision: 5, scale: 2

      add :shelf_life_months, :integer
      add :storage_conditions, :text
      add :food_contact_status, :text

      # Structured per-active claim list. See moduledoc.
      add :active_claims, :jsonb, null: false, default: "[]"
      # General health/nutrition claims (refs to claim_register).
      add :general_claims, :jsonb, null: false, default: "[]"
      # Per-100g + per-serving + NRV table.
      add :nutrition_table, :jsonb, null: false, default: "{}"

      # ISO 3166-1 alpha-2 codes.
      add :target_markets, {:array, :string}, default: []

      add :spec_document_url, :text

      # `may_contain` cross-contamination warning + WHY.
      add :may_contain_allergens, :jsonb, null: false, default: "[]"
      add :may_contain_justification, :text
      add :may_contain_assessed_at, :utc_datetime
      add :may_contain_assessed_by_id, references(:users, on_delete: :nilify_all)

      # Per-spec overrides on the company default contaminant limits.
      # Shape mirrors `companies.default_spec_limits` so the read-side
      # merge is straightforward.
      add :contaminant_limits_overrides, :jsonb, null: false, default: "{}"

      timestamps(type: :utc_datetime)
    end

    create index(:item_finished_product_spec, [:regulatory_category])
    create index(:item_finished_product_spec, [:dosage_form])
    create index(:item_finished_product_spec, [:serving_size_uom_id])
    create index(:item_finished_product_spec, [:net_quantity_uom_id])
  end
end
