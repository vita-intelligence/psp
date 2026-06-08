defmodule Backend.Repo.Migrations.CreateStockLots do
  use Ecto.Migration

  @moduledoc """
  Stock lot — one physical batch as we received it from a supplier or
  produced it in-house. The lot is the logical batch identity:
  qty_received is immutable (the birth quantity); on-hand and
  available are derived from the placements + movements that follow.

  Splitting across cells is handled by stock_lot_placements (one row
  per cell). Every qty change is captured by stock_movements so the
  audit trail is complete without touching the lot row.

  Display code is rendered from id + numbering format (registered as
  `stock_lot` in `Backend.Numbering`) — no stored column.
  """

  def change do
    create table(:stock_lots) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies), null: false
      add :item_id, references(:items, on_delete: :restrict), null: false

      # Workflow state. `:requested` = paperwork exists but goods
      # haven't physically landed; `:received` = live and usable;
      # `:quarantine` = held pending QC; `:depleted` = qty_on_hand
      # reached zero (kept for audit); `:disposed` = written off;
      # `:rejected` = QC fail. UI surfaces and allocation engine read
      # this directly.
      add :status, :string, null: false, default: "requested", size: 24

      # Immutable starting qty. Stays constant for the life of the lot;
      # consumption + writes-offs decrement placements, not this.
      add :qty_received, :decimal, precision: 14, scale: 4, null: false
      add :unit_of_measurement_id,
          references(:units_of_measurement, on_delete: :restrict),
          null: false

      # Costing — stored per-lot (not per-item) so accurate weighted
      # averages roll up later regardless of price changes upstream.
      add :unit_cost, :decimal, precision: 14, scale: 4
      add :currency, :string, size: 3

      # Polymorphic origin. `source_kind` is the discriminator; the
      # `source_ref` field is the human/external reference (PO00447,
      # MO21527, etc.). FK linkage waits until the PO/MO modules ship.
      add :source_kind, :string, size: 24
      add :source_ref, :string, size: 80

      # Provenance. Supplier batch is what the supplier called it on
      # their CoA; our internal code (rendered from id) is what shows
      # on every label and movement.
      add :supplier_batch_no, :string, size: 120
      add :country_of_origin, :string, size: 80
      add :revision, :string, size: 40

      # Compliance status quartet — independently tracked so a lot
      # can have CoA accepted but quality still pending. Each is a
      # short enum (`pending`, `passed`, `failed`, `na`, …) — the
      # exact vocabulary will firm up as QC workflows land.
      add :overall_risk, :string, size: 16
      add :allergen_status, :string, size: 24
      add :coa_status, :string, size: 24
      add :quality_status, :string, size: 24

      # Dates — keep separate columns instead of a JSONB blob so
      # indexes can drive expiry queues and FEFO allocation.
      add :manufactured_at, :date
      add :expiry_at, :date
      add :available_from, :utc_datetime
      add :received_at, :utc_datetime

      add :notes, :text

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:stock_lots, [:uuid])
    create index(:stock_lots, [:company_id, :status])
    create index(:stock_lots, [:item_id])
    # Expiry queue + FEFO allocation both want this hot. Partial
    # index on non-null skips the long tail of lots without expiry
    # (packaging consumables, etc.).
    create index(:stock_lots, [:company_id, :expiry_at],
             where: "expiry_at IS NOT NULL"
           )
    create index(:stock_lots, [:supplier_batch_no],
             where: "supplier_batch_no IS NOT NULL"
           )
  end
end
