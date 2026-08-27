defmodule Backend.Repo.Migrations.RelaxCoLineUniqueForTopUpMos do
  @moduledoc """
  Widens the ``manufacturing_orders_live_co_line_unique`` partial
  index so it treats ``completed`` MOs as terminal (same as
  ``cancelled``). Rationale: the yield-tolerance / shortfall flow
  raises a top-up MO on the same CO line when the first run under-
  delivered — the first MO is completed, but the CO still owes the
  customer the delta, so a second MO must legally exist against
  the same line. Under the original constraint the second insert
  would fail with a unique-violation.

  The race-safety intent of the original index (block two callers
  concurrently creating an MO for a single line) is preserved:
  ``draft``, ``prepared``, ``approved``, ``scheduled``, and
  ``in_progress`` all still collide, so the wizard + NPD adoption
  paths can't produce parallel MO trees.
  """

  use Ecto.Migration

  def up do
    drop_if_exists index(:manufacturing_orders, [:customer_order_line_id],
                     name: :manufacturing_orders_live_co_line_unique
                   )

    create unique_index(:manufacturing_orders, [:customer_order_line_id],
             where:
               "customer_order_line_id IS NOT NULL AND status NOT IN ('completed', 'cancelled')",
             name: :manufacturing_orders_live_co_line_unique
           )
  end

  def down do
    drop_if_exists index(:manufacturing_orders, [:customer_order_line_id],
                     name: :manufacturing_orders_live_co_line_unique
                   )

    create unique_index(:manufacturing_orders, [:customer_order_line_id],
             where: "customer_order_line_id IS NOT NULL AND status <> 'cancelled'",
             name: :manufacturing_orders_live_co_line_unique
           )
  end
end
