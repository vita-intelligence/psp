defmodule Backend.Repo.Migrations.CreateProductionFinalReleaseFiles do
  use Ecto.Migration

  @moduledoc """
  File attachments for Final Product Release (BRCGS 5.3.4 CoA, 5.6
  batch records, 5.4.2 label verification, 5.7 retention samples).

  `kind` is one of: `coa` | `bmr` | `micro` | `label_retain`. The
  Release action refuses to finalise until at least one file of each
  kind is present.

  Bytes live in `Backend.Storage`; this table carries the metadata
  row (mirrors `vendor_files` / `goods_in_inspection_files`).
  """

  def change do
    create table(:production_final_release_files) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies, on_delete: :delete_all), null: false

      add :production_final_release_id,
          references(:production_final_releases, on_delete: :delete_all),
          null: false

      # `coa` — Certificate of Analysis (BRCGS 5.3.4)
      # `bmr` — Batch Manufacturing Record
      # `micro` — Micro / potency test report
      # `label_retain` — Label proof + retention sample photo (BRCGS
      #                  5.4.2 + 5.7)
      add :kind, :string, size: 40, null: false

      add :filename, :string, size: 255, null: false
      add :mime, :string, size: 120, null: false
      add :byte_size, :bigint, null: false
      add :blob_path, :string, size: 500, null: false

      add :uploaded_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:production_final_release_files, [:uuid])
    create index(:production_final_release_files, [:production_final_release_id])

    create index(:production_final_release_files,
             [:production_final_release_id, :kind]
           )
  end
end
