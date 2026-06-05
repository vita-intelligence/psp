defmodule Backend.Repo.Migrations.CreateItemCertificates do
  use Ecto.Migration

  @moduledoc """
  Per-item certificate attachment. M:N between items and the
  `certificates` registry — one cert (e.g. GMP for a site) can cover
  many items; one item can carry many certs (organic + halal + GMP).

  `valid_until` is indexed for the "expiring in 30d" queue (Slice 7).
  """

  def change do
    create table(:item_certificates) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")
      add :item_id, references(:items, on_delete: :delete_all), null: false
      add :certificate_id, references(:certificates, on_delete: :restrict),
        null: false

      add :certificate_number, :string, size: 120
      add :valid_from, :date
      add :valid_until, :date
      add :document_url, :text
      add :notes, :text

      add :uploaded_by_id, references(:users, on_delete: :nilify_all)
      add :uploaded_at, :utc_datetime, null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:item_certificates, [:uuid])
    # The queue: which certs are expiring in the next 30 days.
    create index(:item_certificates, [:valid_until])
    create index(:item_certificates, [:item_id])
    create index(:item_certificates, [:certificate_id])
  end
end
