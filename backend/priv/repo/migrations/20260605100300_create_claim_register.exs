defmodule Backend.Repo.Migrations.CreateClaimRegister do
  use Ecto.Migration

  @moduledoc """
  Regulator-maintained register of approved (and rejected) health +
  nutrition claims. Source-tagged via `source` so we can later support
  multiple jurisdictions (EU 1924/2006 first, FDA/FSA later).

  Items pick from this register via JSONB references on
  `item_finished_product_spec.active_claims` / `.general_claims`.
  We don't denormalise the claim text onto the item — that way when
  EFSA updates wording, the spec sheet renders the latest.

  Seeding lives in a separate data migration so the schema migration
  is fast and re-runnable. See task #226.
  """

  def change do
    create table(:claim_register) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      # Regulator identifier (e.g. EFSA ID for EU). When absent,
      # the platform synthesises a stable hash from the claim text.
      add :claim_code, :string, null: false, size: 80
      add :claim_text, :text, null: false

      # Categorisation per the source's own taxonomy.
      add :category, :string, null: false, size: 40

      # Substance or nutrient the claim relates to (e.g. "Vitamin D").
      add :nutrient_substance, :string, size: 120

      # Regulator-mandated conditions of use (dose, target population, etc.).
      add :conditions_of_use, :text

      # Markets in which this claim is authorised. ISO 3166-1 alpha-2.
      add :jurisdictions, {:array, :string}, default: []

      # Authoritative source: "eu_1924_2006_art_13", "eu_1924_2006_art_14", "fda_qhc", "fsa_ghc", ...
      add :source, :string, null: false, size: 60

      # Approval status — "authorised" / "rejected" / "pending" / "withdrawn".
      add :status, :string, null: false, size: 20

      timestamps(type: :utc_datetime)
    end

    create unique_index(:claim_register, [:uuid])
    create unique_index(:claim_register, [:source, :claim_code])
    create index(:claim_register, [:category])
    create index(:claim_register, [:nutrient_substance])
    create index(:claim_register, [:status])
  end
end
