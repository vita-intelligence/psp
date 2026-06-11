defmodule Backend.Repo.Migrations.CreateItemFiles do
  use Ecto.Migration

  @moduledoc """
  Per-item file attachments — mirrors `vendor_files`.

  Spec sheets, food-contact declarations, migration test reports, and
  related compliance evidence were stored as `*_url` strings on the
  per-type subtables. Plain URLs are not audit-defensible: anyone can
  paste a link, the target can be moved or revoked silently, and the
  bytes the auditor sees later may not be the bytes that were attached
  on the day of sign-off. Moving to byte-archived attachments closes
  the gap — same shape as the vendor + lot + PO + goods-in inspection
  file tables.

  Lifecycle:
    * `kind` is a tag (`spec_sheet`, `food_contact_declaration`,
      `migration_test`, `safety_data_sheet`, `allergen_declaration`,
      `nutritional_analysis`, `other`) — controller validates.
    * Compliance subtables carry an FK to the row this creates.
    * Reassigning a file FK leaves the prior row in place. Auditors
      asking "what spec sheet was filed in March?" are better served
      by a stable blob than a deleted one.

  Data migration: the four `*_url` columns being removed currently
  have zero non-null rows (confirmed before rollout), so the drop is
  loss-free.
  """

  def change do
    create table(:item_files) do
      add :uuid, :uuid, null: false
      add :company_id, references(:companies, on_delete: :delete_all), null: false
      add :item_id, references(:items, on_delete: :delete_all), null: false

      add :kind, :string, size: 40, null: false
      add :filename, :string, size: 255, null: false
      add :mime, :string, size: 120, null: false
      add :byte_size, :bigint, null: false
      add :blob_path, :string, size: 500, null: false

      add :uploaded_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:item_files, [:uuid])
    create index(:item_files, [:item_id])
    create index(:item_files, [:item_id, :kind])

    # Raw-material spec sheet: typed URL → file FK.
    alter table(:item_raw_material_compliance) do
      remove :spec_document_url
      add :spec_document_file_id, references(:item_files, on_delete: :nilify_all)
    end

    # Finished-product spec sheet: typed URL → file FK.
    alter table(:item_finished_product_spec) do
      remove :spec_document_url
      add :spec_document_file_id, references(:item_files, on_delete: :nilify_all)
    end

    # Packaging compliance: two typed URLs → two file FKs.
    alter table(:item_packaging_compliance) do
      remove :food_contact_declaration_url
      remove :migration_test_url
      add :food_contact_declaration_file_id, references(:item_files, on_delete: :nilify_all)
      add :migration_test_file_id, references(:item_files, on_delete: :nilify_all)
    end
  end
end
