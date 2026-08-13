defmodule Backend.Repo.Migrations.UniqLiveMoPerCoLine do
  @moduledoc """
  Prevents duplicate live MOs on the same customer_order_line.

  Race window closed: the sample-CO adoption path
  (``IntegrationManufacturingOrderController.maybe_adopt_wizard_mo``)
  does a plain SELECT to find "is there already an MO for this line"
  and inserts a new one when nothing comes back. Two concurrent
  callers — wizard fires ``create_mo_for_line`` while NPD's slower
  integration retry lands ``POST /manufacturing-orders`` a few
  hundred ms later — could both see nil and both insert, producing
  two parallel MO trees on the same line (the exact bug that dragged
  CO12 back to ``:production_planning``).

  This index makes PostgreSQL enforce the "at most one live MO per
  line" invariant atomically. The insert that loses the race gets a
  unique-constraint error and the controller can fall back to the
  adoption path.

  ``cancelled`` MOs are excluded from the uniqueness constraint
  because cancellation abandons the run — a fresh MO on the same
  line after a cancel is legal (mirrors
  ``manufacturing_orders_npd_trial_batch_uuid_active_unique``).

  NULL ``customer_order_line_id`` is also allowed to repeat — trial
  MOs and legacy production MOs don't link to a CO line.
  """

  use Ecto.Migration

  def up do
    create unique_index(:manufacturing_orders, [:customer_order_line_id],
             where: "customer_order_line_id IS NOT NULL AND status <> 'cancelled'",
             name: :manufacturing_orders_live_co_line_unique
           )
  end

  def down do
    drop_if_exists index(:manufacturing_orders, [:customer_order_line_id],
                     name: :manufacturing_orders_live_co_line_unique
                   )
  end
end
