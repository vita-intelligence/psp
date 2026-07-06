defmodule Backend.Repo.Migrations.AddShipmentDelivery do
  use Ecto.Migration

  def up do
    # Terminal delivery state — a shipment that was `picked_up` and
    # then the customer confirmed receipt. Extends the status check
    # rather than dropping/recreating it (Postgres accepts a widened
    # CHECK in-place).
    execute """
    ALTER TABLE shipments DROP CONSTRAINT shipments_status_check;
    """

    execute """
    ALTER TABLE shipments ADD CONSTRAINT shipments_status_check
      CHECK (status IN ('draft', 'ready', 'picked_up', 'delivered', 'cancelled'));
    """

    alter table(:shipments) do
      add :delivered_at, :utc_datetime
      add :delivered_by_id, references(:users, on_delete: :nilify_all)
      add :recipient_signatory, :string
      add :delivery_notes, :text
    end

    # Delivery-confirmation photos (POD, signed docket, damage
    # evidence). Same shape as `shipment_pickup_files`; kept in a
    # separate physical table so queries like "give me the POD" don't
    # need a `kind` filter and the two audit trails stay clean.
    create table(:shipment_delivery_files) do
      add :uuid, :binary_id, null: false
      add :kind, :string, null: false
      add :filename, :string, null: false
      add :mime, :string, null: false
      add :byte_size, :integer, null: false
      add :blob_path, :string, null: false

      add :company_id, references(:companies, on_delete: :nothing), null: false
      add :shipment_id, references(:shipments, on_delete: :delete_all), null: false
      add :uploaded_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:shipment_delivery_files, [:uuid])
    create index(:shipment_delivery_files, [:shipment_id])
    create index(:shipment_delivery_files, [:company_id])
  end

  def down do
    drop table(:shipment_delivery_files)

    alter table(:shipments) do
      remove :delivered_at
      remove :delivered_by_id
      remove :recipient_signatory
      remove :delivery_notes
    end

    execute """
    ALTER TABLE shipments DROP CONSTRAINT shipments_status_check;
    """

    execute """
    ALTER TABLE shipments ADD CONSTRAINT shipments_status_check
      CHECK (status IN ('draft', 'ready', 'picked_up', 'cancelled'));
    """
  end
end
