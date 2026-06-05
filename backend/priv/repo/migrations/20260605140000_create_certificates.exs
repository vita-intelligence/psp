defmodule Backend.Repo.Migrations.CreateCertificates do
  use Ecto.Migration

  @moduledoc """
  Company-scoped registry of certificate definitions (Organic — Soil
  Association, Halal — HFA, ISO 22000, BRC, FSSC 22000, GMP, IFS,
  HACCP, USDA Organic, Non-GMO Project). Each row is a *type* of cert
  the company tracks; per-item attachments live in
  `item_certificates`.

  `certificate_type` is an enum drawn from the common regulatory list.
  `default_validity_months` lets the FE pre-fill the expiry on a
  new attachment.
  """

  def change do
    create table(:certificates) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies), null: false

      add :name, :string, null: false, size: 120
      add :certificate_type, :string, null: false, size: 32
      add :issuing_body, :string, size: 120
      add :default_validity_months, :integer
      add :description, :text
      add :is_active, :boolean, null: false, default: true

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:certificates, [:uuid])
    create unique_index(:certificates, [:company_id, :name])
    create index(:certificates, [:company_id, :certificate_type, :is_active])
  end
end
