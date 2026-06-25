defmodule Backend.CustomerReturns.CustomerReturnLine do
  @moduledoc """
  One line on an RMA — the item + qty being returned, with a reason
  code and (after inspection) the qty actually accepted plus the
  per-line credit amount that flows onto the auto-generated credit
  note.

  `unit_price` is snapshotted at line-creation time from the linked
  invoice line so the credit note can be issued at the exact rate
  we billed, even if the source invoice is later touched.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Companies.Company
  alias Backend.CustomerInvoices.CustomerInvoiceLine
  alias Backend.CustomerReturns.{CustomerReturn, CustomerReturnLine}
  alias Backend.Items.Item

  @reasons ~w(damaged wrong_item quality_fail customer_changed_mind
              short_shipment overshipment other)

  schema "customer_return_lines" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :qty_returned, :decimal
    field :qty_accepted, :decimal
    field :reason_code, :string
    field :reason_notes, :string
    field :unit_price, :decimal, default: Decimal.new(0)
    field :line_credit_amount, :decimal, default: Decimal.new(0)
    field :inspection_notes, :string

    belongs_to :customer_return, CustomerReturn
    belongs_to :item, Item
    belongs_to :customer_invoice_line, CustomerInvoiceLine
    belongs_to :company, Company

    timestamps(type: :utc_datetime)
  end

  def reasons, do: @reasons

  def changeset(%CustomerReturnLine{} = line, attrs) do
    line
    |> cast(attrs, [
      :customer_return_id,
      :company_id,
      :item_id,
      :customer_invoice_line_id,
      :qty_returned,
      :qty_accepted,
      :reason_code,
      :reason_notes,
      :unit_price,
      :line_credit_amount,
      :inspection_notes
    ])
    |> validate_required([
      :customer_return_id,
      :company_id,
      :item_id,
      :qty_returned,
      :reason_code
    ])
    |> validate_inclusion(:reason_code, @reasons)
    |> validate_number(:qty_returned, greater_than: 0)
    |> maybe_validate_qty_accepted()
    |> validate_number(:unit_price, greater_than_or_equal_to: 0)
    |> validate_length(:reason_notes, max: 2000)
    |> validate_length(:inspection_notes, max: 2000)
  end

  defp maybe_validate_qty_accepted(changeset) do
    accepted = get_field(changeset, :qty_accepted)
    returned = get_field(changeset, :qty_returned)

    cond do
      is_nil(accepted) ->
        changeset

      is_struct(accepted, Decimal) and Decimal.compare(accepted, Decimal.new(0)) == :lt ->
        add_error(changeset, :qty_accepted, "can't be negative")

      is_struct(accepted, Decimal) and is_struct(returned, Decimal) and
          Decimal.compare(accepted, returned) == :gt ->
        add_error(changeset, :qty_accepted, "can't exceed qty returned")

      true ->
        changeset
    end
  end
end
