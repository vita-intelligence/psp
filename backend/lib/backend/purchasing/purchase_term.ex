defmodule Backend.Purchasing.PurchaseTerm do
  @moduledoc """
  Vendor-quoted commercial baseline for a specific item — the
  fallback the "suggest unit price" endpoint reaches for when there
  is no PO history yet. See `Backend.Purchasing.VendorItemPrice` for
  the sibling model that caches actually-paid PO prices.

  One row per (company, vendor, item). Ranked by `priority` (1 =
  primary vendor for this item). The primary term's price is what
  BOM cost roll-ups + spec sheets fall back to when no PO history
  exists on that pair.

  A term cannot be saved unless a matching `vendor_approved_items`
  row exists — enforced in the context service, not the schema, so
  the error surfaces as a domain-level 422 rather than a raw FK
  violation.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Items.Item
  alias Backend.Vendors.Vendor

  schema "vendor_item_purchase_terms" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :vendor_part_no, :string
    field :lead_time_days, :integer

    field :price, :decimal
    field :currency_code, :string

    field :min_quantity, :decimal
    field :min_quantity_uom, :string

    field :priority, :integer, default: 1

    field :valid_from, :date
    field :valid_until, :date

    field :notes, :string

    belongs_to :company, Company
    belongs_to :vendor, Vendor
    belongs_to :item, Item
    # Optional audit trail — who last touched the row. Populated by
    # the context service, not the changeset caller.
    belongs_to :updated_by, User

    timestamps(type: :utc_datetime)
  end

  @castable ~w(
    company_id
    vendor_id
    item_id
    vendor_part_no
    lead_time_days
    price
    currency_code
    min_quantity
    min_quantity_uom
    priority
    valid_from
    valid_until
    notes
    updated_by_id
  )a

  @required ~w(company_id vendor_id item_id price currency_code)a

  def changeset(row, attrs) do
    row
    |> cast(attrs, @castable)
    |> validate_required(@required)
    |> update_change(:currency_code, &normalise_currency/1)
    |> update_change(:vendor_part_no, &String.trim/1)
    |> validate_length(:currency_code, is: 3)
    |> validate_length(:vendor_part_no, max: 100)
    |> validate_length(:min_quantity_uom, max: 20)
    |> validate_length(:notes, max: 4000)
    |> validate_number(:price, greater_than: 0)
    |> validate_number(:lead_time_days, greater_than_or_equal_to: 0)
    |> validate_number(:min_quantity, greater_than: 0)
    |> validate_number(:priority, greater_than: 0)
    |> validate_date_range()
    |> unique_constraint(
      [:company_id, :vendor_id, :item_id],
      name: :vendor_item_purchase_terms_unique_index,
      message: "a purchase term already exists for this vendor + item"
    )
  end

  # ``valid_until`` may be null (open-ended term). When both are set,
  # ensure the range makes sense so a fat-fingered swap doesn't leave
  # a term that reports as "stale" the moment it lands.
  defp validate_date_range(changeset) do
    from = get_field(changeset, :valid_from)
    until = get_field(changeset, :valid_until)

    if from && until && Date.compare(until, from) == :lt do
      add_error(changeset, :valid_until, "must not precede valid_from")
    else
      changeset
    end
  end

  defp normalise_currency(nil), do: nil
  defp normalise_currency(code) when is_binary(code), do: code |> String.trim() |> String.upcase()
end
