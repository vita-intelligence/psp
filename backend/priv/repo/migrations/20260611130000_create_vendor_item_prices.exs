defmodule Backend.Repo.Migrations.CreateVendorItemPrices do
  use Ecto.Migration

  @moduledoc """
  Rolling cache of the last paid price per (vendor, item, currency).

  Compliance rule: a PO line for an item we've bought from this vendor
  before shouldn't make the worker type the unit price from scratch —
  they'll default to whatever the vendor told them, which is exactly
  where price drift hides. Cache the last paid price + timestamp so
  the new-PO-line endpoint can pre-fill and the FE can flag ±20%
  deviations the moment the worker types the proposed number.

  One row per (company, vendor, item, currency) — kept current on
  every PO line that transitions to "received". Re-receiving a line
  overwrites with the same value (idempotent on identical input).
  """

  def change do
    create table(:vendor_item_prices) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :vendor_id, references(:vendors, on_delete: :delete_all), null: false
      add :item_id, references(:items, on_delete: :delete_all), null: false

      # ISO 4217 — normalised uppercase at write time. The vendor's
      # currency lives on the PO header, not the line, so we copy it
      # from the parent at upsert.
      add :currency_code, :string, size: 3, null: false

      add :unit_price, :decimal, precision: 12, scale: 4, null: false

      # Rolling total qty purchased at this (vendor, item, currency).
      # Aggregated by adding each receipt's qty so vendor-detail can
      # show "we've bought N kg from them at this price point".
      add :qty_purchased, :decimal, precision: 14, scale: 4, default: 0, null: false

      add :last_paid_at, :utc_datetime, null: false

      # The PO line that set the current cached value. Lets the FE
      # link back to the receipt that proved the price.
      add :last_po_line_id,
          references(:purchase_order_lines, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:vendor_item_prices, [:uuid])

    # The upsert target. Every (vendor, item, currency) collapses to
    # one row, so the new-PO-line endpoint can fetch by exact key.
    create unique_index(
             :vendor_item_prices,
             [:company_id, :vendor_id, :item_id, :currency_code],
             name: :vendor_item_prices_unique_index
           )

    # Vendor-detail "price history" card sorts by last_paid_at desc.
    create index(
             :vendor_item_prices,
             [:company_id, :vendor_id, :last_paid_at],
             name: :vendor_item_prices_vendor_recent_index
           )
  end
end
