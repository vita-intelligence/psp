defmodule Backend.Repo.Migrations.CreateCustomerOrders do
  use Ecto.Migration

  @moduledoc """
  Customer orders + lines + approval signatures + files + per-customer
  approved-items list.

  Sell-side mirror of `purchase_orders` — same state-machine shape
  with sell-side semantics:

      draft
        ↓ submit (creator)
      pending_approver
        ↓ approver signs
      pending_director
        ↓ director signs
      approved
        ↓ mark as confirmed (committed to customer)
      confirmed         (terminal-ish until picked / shipped / invoiced)

      any non-terminal → cancelled  (with reason)

  Two-tier ESIGN: every CO needs an `approver` signature AND a
  `director` signature, signed by different users (segregation of
  duties enforced in `Backend.CustomerOrders.sign_director/2`).

  V1 stops at `confirmed`. Picked / shipped / invoiced are V2 once
  the warehouse pick flow + invoice module ship.

  `customer_approved_items` is the per-customer approved-products
  list (mirror of `vendor_approved_items`). Empty set = customer
  can buy anything; non-empty = restricted to listed items.
  """

  def change do
    create table(:customer_orders) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :status, :string, size: 30, default: "draft", null: false

      add :customer_id, references(:customers, on_delete: :restrict), null: false
      add :currency_code, :string, size: 3, default: "GBP", null: false

      # Header money — denormalised footer math. The schema deliberately
      # does NOT make these user-castable; `recompute_totals/1` in the
      # context owns them.
      add :subtotal, :decimal, precision: 14, scale: 4, default: 0, null: false
      add :discount_pct, :decimal, precision: 5, scale: 2, default: 0, null: false
      add :discount_amount, :decimal, precision: 12, scale: 2, default: 0, null: false
      add :tax_rate, :decimal, precision: 5, scale: 2, default: 0, null: false
      add :tax_amount, :decimal, precision: 12, scale: 2, default: 0, null: false
      add :shipping_fees, :decimal, precision: 12, scale: 2, default: 0, null: false
      add :additional_fees, :decimal, precision: 12, scale: 2, default: 0, null: false
      add :grand_total, :decimal, precision: 12, scale: 2, default: 0, null: false

      # Fulfilment context — sell-side analog of expected_delivery_date.
      add :expected_ship_date, :date
      add :delivery_address, :text
      add :customer_reference, :string, size: 120
      add :notes, :text

      # Per-CO default warehouse — every line falls back to this when
      # the line itself doesn't override. Required at submit time.
      add :default_warehouse_id, references(:warehouses, on_delete: :nilify_all)

      # State-transition timestamps + actors. Confirmed = "committed to
      # customer", the equivalent of PO's `ordered` (sent to vendor).
      add :submitted_at, :utc_datetime
      add :confirmed_at, :utc_datetime
      add :cancelled_at, :utc_datetime
      add :cancellation_reason, :text

      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)
      add :submitted_by_id, references(:users, on_delete: :nilify_all)
      add :confirmed_by_id, references(:users, on_delete: :nilify_all)
      add :cancelled_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:customer_orders, [:uuid])
    create index(:customer_orders, [:company_id, :status])
    create index(:customer_orders, [:customer_id])
    create index(:customer_orders, [:default_warehouse_id])
    create index(:customer_orders, [:expected_ship_date])

    create table(:customer_order_lines) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :customer_order_id,
          references(:customer_orders, on_delete: :delete_all),
          null: false

      add :item_id, references(:items, on_delete: :restrict), null: false

      add :qty_ordered, :decimal, precision: 14, scale: 4, null: false
      add :unit_price, :decimal, precision: 14, scale: 4, default: 0, null: false

      # Per-line discount — the per-CO discount lives on the header.
      # Both apply (line discount first, then header discount on
      # subtotal-after-line-discounts).
      add :discount_pct, :decimal, precision: 5, scale: 2, default: 0, null: false

      # `(qty_ordered × unit_price) × (1 - discount_pct/100)`. Stored
      # so list footers don't have to recompute per-render.
      add :line_subtotal, :decimal, precision: 14, scale: 4, default: 0, null: false

      add :expected_ship_date, :date
      add :customer_part_no, :string, size: 120
      add :notes, :text

      # Per-line pick-from warehouse (multi-warehouse Vita). Falls
      # back to `default_warehouse_id` on the header. Required at
      # submit time (either line or default must be set).
      add :warehouse_id, references(:warehouses, on_delete: :nilify_all)

      # Audit trail for the price origin: which pricelist row was
      # quoted at line-creation time? Lets a future audit answer
      # "why did we quote £X to this customer in March?". Nullable
      # so a manual-override line (no pricelist hit) still saves.
      add :pricelist_id, references(:pricelists, on_delete: :nilify_all)

      add :company_id, references(:companies, on_delete: :restrict), null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:customer_order_lines, [:uuid])
    create index(:customer_order_lines, [:customer_order_id])
    create index(:customer_order_lines, [:item_id])
    create index(:customer_order_lines, [:warehouse_id])

    create table(:customer_order_approvals) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :customer_order_id,
          references(:customer_orders, on_delete: :delete_all),
          null: false

      # `approver` (sales lead / account manager) or `director`.
      add :kind, :string, size: 20, null: false

      add :signed_at, :utc_datetime, null: false
      add :notes, :text

      # Base64-encoded PNG of signature-pad capture. Optional — not
      # every shop runs a pad, but the audit row still records who
      # clicked Approve.
      add :signature_image, :text

      add :signed_by_id, references(:users, on_delete: :nilify_all), null: false
      add :company_id, references(:companies, on_delete: :restrict), null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:customer_order_approvals, [:uuid])

    create unique_index(:customer_order_approvals, [:customer_order_id, :kind],
             name: :customer_order_approvals_co_kind_index
           )

    create index(:customer_order_approvals, [:signed_by_id])

    create table(:customer_order_files) do
      add :uuid, :uuid, null: false
      add :customer_order_id,
          references(:customer_orders, on_delete: :delete_all),
          null: false

      add :company_id, references(:companies, on_delete: :delete_all),
        null: false

      # quote | proforma | shipping_doc | other
      add :kind, :string, size: 40, null: false

      add :filename, :string, size: 255, null: false
      add :mime, :string, size: 120, null: false
      add :byte_size, :bigint, null: false
      add :blob_path, :string, size: 500, null: false

      add :uploaded_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:customer_order_files, [:uuid])
    create index(:customer_order_files, [:customer_order_id])

    # Per-customer approved-items list. Empty (no rows for the customer)
    # = customer can buy anything. Non-empty = restricted to listed
    # items, enforced at CO submit time.
    create table(:customer_approved_items) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :customer_id, references(:customers, on_delete: :delete_all),
        null: false

      add :item_id, references(:items, on_delete: :delete_all), null: false

      add :approved_at, :utc_datetime
      add :notes, :text

      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :approved_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:customer_approved_items, [:customer_id, :item_id],
             name: :customer_approved_items_customer_item_index
           )

    create index(:customer_approved_items, [:company_id])
    create index(:customer_approved_items, [:item_id])
  end
end
