defmodule Backend.Purchasing.VendorItemPrice do
  @moduledoc """
  Cached "last paid price" per (vendor, item, currency). Maintained
  by `Backend.Purchasing.VendorPrices` on every PO line receipt;
  read by the new-PO-line endpoint to pre-fill `unit_price` and to
  flag ±20% deviations.

  Not user-editable — the row is a projection of the audit trail
  of received PO lines, not a free-form catalog. Workers can override
  the suggested price on the PO line itself (with the deviation
  warning surfaced inline); this cache always reflects what was
  actually paid, not what someone thinks the next price should be.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Companies.Company
  alias Backend.Items.Item
  alias Backend.Purchasing.PurchaseOrderLine
  alias Backend.Vendors.Vendor

  schema "vendor_item_prices" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :currency_code, :string
    field :unit_price, :decimal
    field :qty_purchased, :decimal, default: Decimal.new(0)
    field :last_paid_at, :utc_datetime

    belongs_to :company, Company
    belongs_to :vendor, Vendor
    belongs_to :item, Item
    belongs_to :last_po_line, PurchaseOrderLine

    timestamps(type: :utc_datetime)
  end

  def changeset(row, attrs) do
    row
    |> cast(attrs, [
      :company_id,
      :vendor_id,
      :item_id,
      :currency_code,
      :unit_price,
      :qty_purchased,
      :last_paid_at,
      :last_po_line_id
    ])
    |> validate_required([
      :company_id,
      :vendor_id,
      :item_id,
      :currency_code,
      :unit_price,
      :last_paid_at
    ])
    |> update_change(:currency_code, &normalise_currency/1)
    |> validate_length(:currency_code, is: 3)
    |> validate_number(:unit_price, greater_than: 0)
    |> validate_number(:qty_purchased, greater_than_or_equal_to: 0)
    |> unique_constraint(
      [:company_id, :vendor_id, :item_id, :currency_code],
      name: :vendor_item_prices_unique_index
    )
  end

  defp normalise_currency(nil), do: nil
  defp normalise_currency(code) when is_binary(code), do: code |> String.trim() |> String.upcase()
end
