defmodule Backend.Repo.Migrations.CreatePoFiles do
  use Ecto.Migration

  @moduledoc """
  Per-PO evidence file attachments — quotes, spec sheets, anything the
  buyer wants to hand the supplier alongside the order.

  Mirrors `vendor_files` exactly so the FE upload component is reusable
  and the auditor sees the same shape of provenance (bytes + filename
  + mime + size + uploader) for vendor evidence and PO evidence.

  Orphans tolerated the same way as `vendor_files` — auditor asking
  "what was attached to PO#42 in March" is better served by an extra
  blob than by a hard-deleted one.
  """

  def change do
    create table(:po_files) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies, on_delete: :delete_all), null: false

      add :purchase_order_id,
          references(:purchase_orders, on_delete: :delete_all),
          null: false

      # Free-form tag — controller validates against an allow list, but
      # adding a new kind (e.g. shipping_label) is a value change, not
      # a schema change.
      add :kind, :string, size: 40, null: false

      add :filename, :string, size: 255, null: false
      add :mime, :string, size: 120, null: false
      add :byte_size, :bigint, null: false
      add :blob_path, :string, size: 500, null: false

      add :uploaded_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:po_files, [:uuid])
    create index(:po_files, [:purchase_order_id])
    create index(:po_files, [:purchase_order_id, :kind])
  end
end
