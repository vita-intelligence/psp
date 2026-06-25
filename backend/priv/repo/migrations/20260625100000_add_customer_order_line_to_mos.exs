defmodule Backend.Repo.Migrations.AddCustomerOrderLineToMos do
  use Ecto.Migration

  @moduledoc """
  Anchors a manufacturing_order to the customer_order_line it's
  producing for. Nullable on purpose:

    * `NULL`     — make-for-stock MO (no specific customer
      commitment). The default until this point in PSP history.
    * `set`      — MO is producing for a specific CO line. The
      wizard projects "this CO's production status" by walking
      this FK.

  We use `customer_order_line_id` (not just `customer_order_id`)
  because:
    1. The CO is rolled-up money; the LINE is the producible unit
       (one item + qty). One MO maps to one CO line; "% complete
       per line" is then trivial.
    2. A single CO can have multiple lines hitting different
       items; each line needs its own MO. The wizard walks the
       lines, not the order header.

  `on_delete: :nilify_all` — cancelling a CO must not cascade and
  delete the MOs the floor has already started running. The
  business reaction to "we shouldn't have promised this" is a
  separate decision (cancel the MO, finish it as stock, etc.).
  """

  def change do
    alter table(:manufacturing_orders) do
      add :customer_order_line_id,
          references(:customer_order_lines, on_delete: :nilify_all)
    end

    create index(:manufacturing_orders, [:customer_order_line_id])
  end
end
