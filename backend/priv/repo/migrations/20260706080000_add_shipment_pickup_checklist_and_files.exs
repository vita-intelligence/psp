defmodule Backend.Repo.Migrations.AddShipmentPickupChecklistAndFiles do
  use Ecto.Migration

  def change do
    # Truck-arrival checklist. Every value MUST be `true` at pickup —
    # the confirm_pickup context enforces this and the frontend renders
    # them as touch-target checkboxes on the mobile dispatch form.
    # Nullable in the DB so pre-existing draft/ready shipments back-fill
    # cleanly; the enforcement lives in the changeset.
    alter table(:shipments) do
      add :packaging_intact, :boolean
      add :labels_verified, :boolean
      add :vehicle_clean_suitable, :boolean
      add :transport_condition_acceptable, :boolean
      add :dispatch_approved, :boolean
    end

    # Photos captured by the operator on the truck (BRCGS Issue 9 §
    # 5.4.6 — a visual record of what actually left the site). Mirrors
    # `goods_in_inspection_files` exactly so the FE upload component +
    # storage layout are reusable and auditors see the same shape on
    # every attachment row.
    create table(:shipment_pickup_files) do
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

    create unique_index(:shipment_pickup_files, [:uuid])
    create index(:shipment_pickup_files, [:shipment_id])
    create index(:shipment_pickup_files, [:company_id])
  end
end
