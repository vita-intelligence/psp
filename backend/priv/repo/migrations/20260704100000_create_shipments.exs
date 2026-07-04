defmodule Backend.Repo.Migrations.CreateShipments do
  use Ecto.Migration

  # A `shipment` is the customer-facing outbound record BRCGS Issue 9
  # § 5.4.6 wants us to keep: who received it, what was on the truck,
  # who drove it, on what vehicle, under what seal / temperature, and
  # when it left the warehouse. One shipment references one stock lot
  # in bailee custody or a released own-stock lot; multi-lot loads
  # (multiple lines per shipment) can be added later when the
  # workflow needs it.
  #
  # Lifecycle: draft → ready → picked_up. Draft = still being filled
  # out. Ready = paperwork complete, waiting for the truck. Picked_up
  # = driver signed and left (later mobile flow captures the truck-
  # arrival form; for now `Backend.Shipments.confirm_pickup/2` just
  # flips the flag).
  def change do
    create table(:shipments) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :stock_lot_id, references(:stock_lots, on_delete: :restrict), null: false
      add :customer_id, references(:customers, on_delete: :restrict), null: true
      add :customer_order_id,
          references(:customer_orders, on_delete: :nilify_all),
          null: true

      # Ship-to address block.
      add :recipient_name, :string, size: 200
      add :ship_to_address, :text
      add :ship_to_country, :string, size: 2

      # Carrier + vehicle.
      add :carrier, :string, size: 200
      add :vehicle_registration, :string, size: 40
      add :driver_name, :string, size: 200
      add :consignment_note_ref, :string, size: 80
      add :seal_number, :string, size: 60
      add :temperature_c, :decimal, precision: 5, scale: 2

      # Qty being shipped (matches the lot placement in the dispatch cell).
      add :qty, :decimal, precision: 14, scale: 4, null: false

      add :planned_ship_at, :utc_datetime
      add :notes, :text

      # Evidence — loading photo (packages on the truck).
      add :loading_photo_url, :string, size: 500

      add :status, :string, null: false, default: "draft"

      # Lifecycle stamps.
      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :ready_at, :utc_datetime
      add :ready_by_id, references(:users, on_delete: :nilify_all)
      add :picked_up_at, :utc_datetime
      add :picked_up_by_id, references(:users, on_delete: :nilify_all)
      add :cancelled_at, :utc_datetime
      add :cancelled_by_id, references(:users, on_delete: :nilify_all)
      add :cancel_reason, :string, size: 500

      timestamps(type: :utc_datetime)
    end

    create unique_index(:shipments, [:uuid])
    create index(:shipments, [:company_id])
    create index(:shipments, [:stock_lot_id])
    create index(:shipments, [:customer_id])
    create index(:shipments, [:customer_order_id])
    create index(:shipments, [:status])

    execute(
      """
      ALTER TABLE shipments
        ADD CONSTRAINT shipments_status_check
        CHECK (status IN ('draft','ready','picked_up','cancelled'))
      """,
      """
      ALTER TABLE shipments
        DROP CONSTRAINT IF EXISTS shipments_status_check
      """
    )

    execute(
      """
      ALTER TABLE shipments
        ADD CONSTRAINT shipments_qty_positive_check
        CHECK (qty > 0)
      """,
      """
      ALTER TABLE shipments
        DROP CONSTRAINT IF EXISTS shipments_qty_positive_check
      """
    )
  end
end
