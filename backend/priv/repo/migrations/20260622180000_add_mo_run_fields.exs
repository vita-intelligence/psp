defmodule Backend.Repo.Migrations.AddMoRunFields do
  use Ecto.Migration

  # Production-run lifecycle. The operator hits Start when they
  # physically begin work (stamps `actual_start`), then Finish at the
  # end — that form captures `actual_finish` + `quantity_produced` +
  # auto-creates a `stock_lot` for the manufactured output and links
  # it via `produced_lot_id`. The post-production return flow walks
  # the bookings + the produced lot back to the warehouse, recording
  # consumption as it goes.
  #
  # Step-level `actual_start` / `actual_finish` already exist on
  # `manufacturing_order_steps`; the MO-level fields here are the
  # operator's coarse sign-off times (matches how MRPEasy presents
  # the run), not derived. They can diverge from min/max(step times)
  # when a step is logged retroactively.
  def change do
    alter table(:manufacturing_orders) do
      add :actual_start, :utc_datetime
      add :actual_finish, :utc_datetime
      add :quantity_produced, :decimal, precision: 18, scale: 4
      add :produced_lot_id, references(:stock_lots, on_delete: :nilify_all)
    end

    create constraint(:manufacturing_orders, :mo_quantity_produced_non_negative,
             check: "quantity_produced IS NULL OR quantity_produced >= 0"
           )

    create constraint(:manufacturing_orders, :mo_actual_finish_after_start,
             check:
               "actual_finish IS NULL OR actual_start IS NULL OR actual_finish >= actual_start"
           )

    create index(:manufacturing_orders, [:actual_start])
    create index(:manufacturing_orders, [:actual_finish])
  end
end
