defmodule Backend.Repo.Migrations.CreateItemPackagingCompliance do
  use Ecto.Migration

  @moduledoc """
  Packaging compliance — 1:1 with `items` where `item_type =
  "packaging"`. Carries food-contact + recyclability + migration test
  metadata. Migration test expiry is indexed for the "expiring soon"
  queue (Slice 7).
  """

  def change do
    create table(:item_packaging_compliance, primary_key: false) do
      add :item_id, references(:items, on_delete: :delete_all),
        primary_key: true,
        null: false

      add :material, :string, size: 24
      add :food_contact_compliant, :boolean
      add :food_contact_declaration_url, :text
      # Resin Identification Code per ASTM D7611 / ISO 11469.
      add :recyclability_code, :string, size: 16
      add :migration_test_url, :text
      add :migration_test_expires_at, :date

      timestamps(type: :utc_datetime)
    end

    # Drives the expiring-soon queue.
    create index(:item_packaging_compliance, [:migration_test_expires_at])
    create index(:item_packaging_compliance, [:material])
  end
end
