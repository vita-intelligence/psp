defmodule Backend.Repo.Migrations.CreateThreePlDispatches do
  use Ecto.Migration

  # Phase 3 of the 3PL flow: partial-lot outbound dispatch. Each row
  # is one physical send-out — qty (fractional units allowed), photo
  # evidence pointing at the dispatched packages on the trolley, an
  # optional reference (carrier waybill, customer PO reference), and
  # the audit stamp for the operator + time. Cumulative dispatched
  # for a lot is `SUM(qty)` over live rows; remaining bailee custody
  # is `SUM(placements.qty) - SUM(dispatched.qty)` — but in practice
  # we mutate the placement in the same transaction that inserts the
  # dispatch row, so the placement itself is the source of truth for
  # "what's still in bailee custody right now".
  def change do
    create table(:three_pl_dispatches) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :stock_lot_id, references(:stock_lots, on_delete: :restrict), null: false
      add :qty, :decimal, precision: 14, scale: 4, null: false
      add :reference, :string, size: 200
      add :notes, :text
      add :photo_url, :string
      add :dispatched_by_id, references(:users, on_delete: :nilify_all)
      add :dispatched_at, :utc_datetime, null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:three_pl_dispatches, [:uuid])
    create index(:three_pl_dispatches, [:stock_lot_id])
    create index(:three_pl_dispatches, [:company_id])
    create index(:three_pl_dispatches, [:dispatched_at])

    execute(
      """
      ALTER TABLE three_pl_dispatches
        ADD CONSTRAINT three_pl_dispatches_qty_positive_check
        CHECK (qty > 0)
      """,
      """
      ALTER TABLE three_pl_dispatches
        DROP CONSTRAINT IF EXISTS three_pl_dispatches_qty_positive_check
      """
    )
  end
end
