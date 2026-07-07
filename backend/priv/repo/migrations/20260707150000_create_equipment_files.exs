defmodule Backend.Repo.Migrations.CreateEquipmentFiles do
  use Ecto.Migration

  @moduledoc """
  File attachments for equipment units. Same shape as `lot_files` /
  `po_files` / `vendor_files`: bytes live in Backend.Storage, this
  row carries metadata + the opaque blob path.

  Kinds are free-form at the DB level; controller validates against a
  known list (calibration_certificate, service_report,
  manual, photo, warranty, other) so the FE filter chips stay stable.
  """

  def change do
    create table(:equipment_files) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies, on_delete: :delete_all), null: false
      add :equipment_id, references(:equipment, on_delete: :delete_all), null: false

      add :kind, :string, size: 40, null: false
      add :filename, :string, size: 255, null: false
      add :mime, :string, size: 120, null: false
      add :byte_size, :bigint, null: false
      add :blob_path, :string, size: 500, null: false

      add :uploaded_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:equipment_files, [:uuid])
    create index(:equipment_files, [:equipment_id])
    create index(:equipment_files, [:equipment_id, :kind])
    create index(:equipment_files, [:company_id])
  end
end
