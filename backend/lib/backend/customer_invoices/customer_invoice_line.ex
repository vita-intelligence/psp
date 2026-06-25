defmodule Backend.CustomerInvoices.CustomerInvoiceLine do
  @moduledoc """
  One line on a customer invoice. Both `item_id` and
  `customer_order_line_id` are optional:

    * `item_id` nil ⇒ free-text line (consulting hours, ad-hoc charge)
    * `customer_order_line_id` not-nil ⇒ this line originated from a
      CO line. The "Order" column on the invoice payload reads off
      this FK so the invoice page can show which CO line it traces
      back to.

  When both are set (the common case for CO-generated invoices) we
  inherit `item_id` from the CO line at create time.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Companies.Company
  alias Backend.CustomerInvoices.CustomerInvoice
  alias Backend.CustomerOrders.CustomerOrderLine
  alias Backend.Items.Item

  schema "customer_invoice_lines" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :description, :string
    field :qty, :decimal
    field :unit_price, :decimal, default: Decimal.new(0)
    field :discount_pct, :decimal, default: Decimal.new(0)
    field :line_subtotal, :decimal, default: Decimal.new(0)

    field :delivery_date, :date
    field :notes, :string

    belongs_to :customer_invoice, CustomerInvoice
    belongs_to :item, Item
    belongs_to :customer_order_line, CustomerOrderLine
    belongs_to :company, Company

    timestamps(type: :utc_datetime)
  end

  def changeset(line, attrs) do
    line
    |> cast(attrs, [
      :customer_invoice_id,
      :company_id,
      :item_id,
      :customer_order_line_id,
      :description,
      :qty,
      :unit_price,
      :discount_pct,
      :line_subtotal,
      :delivery_date,
      :notes
    ])
    |> validate_required([:customer_invoice_id, :company_id, :qty, :unit_price])
    # Credit-note lines carry negative qty so the parent invoice's
    # grand_total comes out negative (subtracting from customer A/R
    # when summed). Regular invoices still pass positive; the only
    # meaningless value is zero.
    |> validate_number(:qty, not_equal_to: 0)
    |> validate_number(:unit_price, greater_than_or_equal_to: 0)
    |> validate_number(:discount_pct,
      greater_than_or_equal_to: 0,
      less_than_or_equal_to: 100
    )
    |> validate_length(:description, max: 500)
    |> validate_length(:notes, max: 2000)
    |> validate_item_or_description()
  end

  # Every line needs either an item_id OR a non-blank description —
  # otherwise the customer sees a £-only row with no idea what they're
  # being billed for.
  defp validate_item_or_description(changeset) do
    item_id = get_field(changeset, :item_id)
    desc = get_field(changeset, :description)

    if is_nil(item_id) and (is_nil(desc) or String.trim(desc) == "") do
      add_error(
        changeset,
        :description,
        "either pick an item or write a description"
      )
    else
      changeset
    end
  end
end
