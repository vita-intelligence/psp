defmodule Backend.Repo.Migrations.CreateVendorFiles do
  use Ecto.Migration

  @moduledoc """
  Generic file attachment for vendor evidence.

  Typed-URL columns are insufficient for audit defensibility — anyone
  can paste a URL into a field, and the auditor has no proof the file
  on the other side hasn't been swapped. Real traceability requires
  the bytes themselves to live in our own storage, with an immutable
  blob path + uploaded-by stamp + checksum if we ever want to prove
  the artifact at QA-sign time is the same as the artifact months
  later.

  This table backs SAQ, audit report, COA, and per-certificate
  document uploads. `kind` is a tag for filtering / payload shaping,
  not a constraint — adding a new artifact type is a value, not a
  schema change.

  Lifecycle: rows are created via the file-upload endpoint; the
  qualification + certificate writes carry a `file_id` referencing
  the row. When the foreign key is reassigned (replacing the file),
  the previous row sticks around — orphan files are tolerated
  the same way movement photos are, on the theory that an auditor
  asking "what was the SAQ in March?" is better served by an extra
  blob than by a deleted one.
  """

  def change do
    create table(:vendor_files) do
      add :uuid, :uuid, null: false
      add :company_id, references(:companies, on_delete: :delete_all), null: false
      add :vendor_id, references(:vendors, on_delete: :delete_all), null: false

      # Tag identifying which artifact this file backs (saq, audit,
      # coa, certificate, …). Free-form — controller validates.
      add :kind, :string, size: 40, null: false

      add :filename, :string, size: 255, null: false
      add :mime, :string, size: 120, null: false
      add :byte_size, :bigint, null: false
      add :blob_path, :string, size: 500, null: false

      add :uploaded_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:vendor_files, [:uuid])
    create index(:vendor_files, [:vendor_id])
    create index(:vendor_files, [:vendor_id, :kind])

    # Qualification artifact file pointers. We're swapping the typed
    # URL columns for FK references — those URL columns landed earlier
    # in this same migration window and have no production data, so
    # the drop is safe.
    alter table(:vendors) do
      remove :saq_document_url
      remove :audit_document_url
      remove :coa_document_url

      add :saq_file_id, references(:vendor_files, on_delete: :nilify_all)
      add :audit_file_id, references(:vendor_files, on_delete: :nilify_all)
      add :coa_file_id, references(:vendor_files, on_delete: :nilify_all)
    end

    # Certificate attachment also moves from typed URL → file FK so
    # the regulator can verify the cert PDF the same way they verify
    # the audit report.
    alter table(:vendor_certificates) do
      remove :document_url
      add :document_file_id, references(:vendor_files, on_delete: :nilify_all)
    end
  end
end
