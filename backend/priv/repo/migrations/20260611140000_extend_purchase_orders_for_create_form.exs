defmodule Backend.Repo.Migrations.ExtendPurchaseOrdersForCreateForm do
  use Ecto.Migration

  @moduledoc """
  Single-page PO create form needs the header to carry full footer math
  (whole-PO discount, tax, shipping, additional fees → grand_total) and
  a default delivery warehouse. Lines need a per-line warehouse override
  + a vendor's part code so buyers can hand a complete spec to the
  supplier.

  All four totals (`subtotal`, `discount_amount`, `tax_amount`,
  `grand_total`) are server-computed in `Backend.Purchasing.recompute_totals/1`
  — the schema deliberately does NOT make them user-castable. This
  migration just provisions the columns; the math lives in the context.

  Backfill: existing rows keep `subtotal` as-is; the other components
  default to 0 so `grand_total` collapses to subtotal — set inline so
  no PO surfaces with a stale 0 footer.
  """

  def change do
    alter table(:purchase_orders) do
      add :discount_pct, :decimal, precision: 5, scale: 2, default: 0, null: false
      add :discount_amount, :decimal, precision: 12, scale: 2, default: 0, null: false
      add :tax_rate, :decimal, precision: 5, scale: 2, default: 0, null: false
      add :shipping_fees, :decimal, precision: 12, scale: 2, default: 0, null: false
      add :additional_fees, :decimal, precision: 12, scale: 2, default: 0, null: false
      add :grand_total, :decimal, precision: 12, scale: 2, default: 0, null: false

      add :default_warehouse_id, references(:warehouses, on_delete: :nilify_all)
    end

    alter table(:purchase_order_lines) do
      add :warehouse_id, references(:warehouses, on_delete: :nilify_all)
      add :vendor_part_no, :string, size: 120
    end

    create index(:purchase_orders, [:default_warehouse_id])
    create index(:purchase_order_lines, [:warehouse_id])

    # Backfill: existing POs have no discount / tax / shipping
    # components yet, so grand_total collapses to whatever subtotal
    # was already denormalised on the row. Done in SQL so a fresh
    # frontend render of an old PO doesn't show £0 in the footer
    # next to a non-zero line total.
    execute(
      "UPDATE purchase_orders SET grand_total = COALESCE(subtotal, 0)",
      "UPDATE purchase_orders SET grand_total = 0"
    )
  end
end
