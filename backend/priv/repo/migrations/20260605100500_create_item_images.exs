defmodule Backend.Repo.Migrations.CreateItemImages do
  use Ecto.Migration

  @moduledoc """
  Per-item image gallery. One row per uploaded image. Storage is
  Azure blob; rows carry the blob path, signing happens at payload
  time (1h SAS) per the vita-cff pattern.

  Exactly one row per item is `is_primary = true` — enforced by a
  partial unique index so SET primary swaps must clear the old one
  in the same transaction. Caption is optional alt-text-ish; sort_order
  lets the user drag-to-reorder the gallery.

  Images are fully optional. An item with no rows here renders the
  default placeholder in the UI.
  """

  def change do
    create table(:item_images) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")
      add :item_id, references(:items, on_delete: :delete_all), null: false

      # Path in the Azure container — not the signed URL. Signing
      # happens at payload time so the URL stays fresh and the row
      # doesn't grow stale.
      add :blob_path, :string, null: false, size: 500

      # Optional caption. Used as alt-text on the FE.
      add :caption, :string, size: 200

      add :is_primary, :boolean, null: false, default: false
      add :sort_order, :integer, null: false, default: 0

      # Original filename (for download UX + audit).
      add :original_filename, :string, size: 200
      add :content_type, :string, size: 80
      add :byte_size, :integer

      add :uploaded_by_id, references(:users, on_delete: :nilify_all)
      add :uploaded_at, :utc_datetime, null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:item_images, [:uuid])
    # At most one primary image per item. Partial index keeps the
    # constraint cheap.
    create unique_index(:item_images, [:item_id],
             where: "is_primary = true",
             name: :item_images_one_primary_per_item
           )
    create index(:item_images, [:item_id, :sort_order])
  end
end
