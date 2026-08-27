defmodule Backend.Repo.Migrations.AddYieldToleranceAndCoLineReservations do
  use Ecto.Migration

  # Production yield tolerance & customer-order fulfilment
  # reconciliation. Three parts:
  #
  #   1. ``companies.production_yield_tolerance_pct`` — the
  #      company-wide acceptable variance between an MO's planned
  #      ``quantity`` and its actual ``quantity_produced``. Consumed
  #      by the closeout variance classifier and the CO fulfilment
  #      gate. Default 10% matches the Vita ops rule of thumb.
  #
  #   2. ``manufacturing_orders.yield_variance_pct`` — the recorded
  #      variance stamped at closeout, kept for reporting / audit
  #      independent of any later tolerance edits.
  #
  #   3. ``co_line_lot_reservations`` — earmark of a produced lot's
  #      qty against a specific CustomerOrderLine. Created
  #      automatically on surplus closeout ("we produced 11k for a
  #      10k order — reserve 10k, leave 1k as free stock"). The
  #      dispatch flow reads this to cap the shipment qty at the
  #      reserved amount, so the surplus stays in the warehouse
  #      instead of being over-shipped.
  def change do
    alter table(:companies) do
      add :production_yield_tolerance_pct, :decimal,
        precision: 5,
        scale: 2,
        null: false,
        default: 10.00
    end

    create constraint(:companies, :companies_yield_tolerance_pct_bounded,
             check: "production_yield_tolerance_pct >= 0 AND production_yield_tolerance_pct <= 100"
           )

    alter table(:manufacturing_orders) do
      add :yield_variance_pct, :decimal, precision: 8, scale: 4, null: true
    end

    create table(:co_line_lot_reservations) do
      add :uuid, :uuid, null: false

      add :company_id,
          references(:companies, on_delete: :restrict),
          null: false

      add :customer_order_line_id,
          references(:customer_order_lines, on_delete: :delete_all),
          null: false

      add :stock_lot_id,
          references(:stock_lots, on_delete: :restrict),
          null: false

      # Source MO — the run that produced the lot. Nullable in case
      # a reservation is later hand-attached to a lot from a
      # non-production source (manual reserve for a walk-in order).
      add :manufacturing_order_id,
          references(:manufacturing_orders, on_delete: :nilify_all),
          null: true

      add :quantity, :decimal, precision: 20, scale: 10, null: false

      # How this reservation came into existence — audit trail for
      # "was it auto-split from a surplus closeout, or did an
      # operator carve it out by hand". Values:
      #   * ``"auto_surplus"`` — set by
      #     ``Backend.Production.finish_mo_production`` on the surplus
      #     branch.
      #   * ``"manual"`` — hand-carved via the stock-lot detail page.
      add :origin, :string, null: false, default: "auto_surplus"

      add :notes, :string

      add :created_by_id,
          references(:users, on_delete: :nilify_all),
          null: true

      add :updated_by_id,
          references(:users, on_delete: :nilify_all),
          null: true

      timestamps(type: :utc_datetime)
    end

    create unique_index(:co_line_lot_reservations, [:uuid])
    create index(:co_line_lot_reservations, [:customer_order_line_id])
    create index(:co_line_lot_reservations, [:stock_lot_id])
    create index(:co_line_lot_reservations, [:manufacturing_order_id])

    create constraint(:co_line_lot_reservations, :co_line_lot_reservations_qty_positive,
             check: "quantity > 0"
           )

    create constraint(:co_line_lot_reservations, :co_line_lot_reservations_origin_known,
             check: "origin IN ('auto_surplus', 'manual')"
           )
  end
end
