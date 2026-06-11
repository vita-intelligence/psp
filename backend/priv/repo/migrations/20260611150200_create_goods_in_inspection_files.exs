defmodule Backend.Repo.Migrations.CreateGoodsInInspectionFiles do
  use Ecto.Migration

  @moduledoc """
  Photos + supplier documents attached to a goods-in inspection.

  Mirrors `vendor_files` / `po_files` so the FE upload component is
  reusable and the auditor sees the same provenance shape (bytes +
  filename + mime + size + uploader) everywhere.

  Orphans tolerated the same way as the sibling tables: the auditor
  asking "what evidence backed the QC verdict on this delivery?" is
  better served by an extra blob than by a hard-deleted one.
  """

  def change do
    create table(:goods_in_inspection_files) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies, on_delete: :delete_all), null: false

      add :goods_in_inspection_id,
          references(:goods_in_inspections, on_delete: :delete_all),
          null: false

      # `photo | coa | other`. Controller validates; adding a new kind
      # is a value change, not a schema change.
      add :kind, :string, size: 40, null: false

      add :filename, :string, size: 255, null: false
      add :mime, :string, size: 120, null: false
      add :byte_size, :bigint, null: false
      add :blob_path, :string, size: 500, null: false

      add :uploaded_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:goods_in_inspection_files, [:uuid])
    create index(:goods_in_inspection_files, [:goods_in_inspection_id])
    create index(:goods_in_inspection_files, [:goods_in_inspection_id, :kind])
  end
end
