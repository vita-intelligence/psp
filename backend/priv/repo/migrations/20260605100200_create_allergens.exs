defmodule Backend.Repo.Migrations.CreateAllergens do
  use Ecto.Migration

  @moduledoc """
  Global lookup of the EU FIC Annex II declared allergens. NOT
  company-scoped — every tenant references the same canonical list so
  cross-tenant reports (e.g. "all raw materials containing peanuts in
  the platform") stay coherent. Seeded by a follow-up migration with
  the 14 EU allergens.

  Sourced from EU 1169/2011 Annex II — the "Big 14" list. Tenants
  can't add to it; if a new allergen ever appears in regulation
  (highly unusual), it's a code change.
  """

  def change do
    create table(:allergens) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")
      add :key, :string, null: false, size: 40
      add :label, :string, null: false, size: 120
      # Regulatory document the entry comes from (e.g. "eu_1169_2011_annex_ii").
      add :source, :string, null: false, size: 60, default: "eu_1169_2011_annex_ii"
      # Display order for the form picker.
      add :sort_order, :integer, null: false, default: 0
      timestamps(type: :utc_datetime)
    end

    create unique_index(:allergens, [:key])
    create unique_index(:allergens, [:uuid])
  end
end
