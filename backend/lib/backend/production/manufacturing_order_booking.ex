defmodule Backend.Production.ManufacturingOrderBooking do
  @moduledoc """
  A logical reservation of `quantity` from a `stock_lot` against a
  manufacturing order. Bookings don't move stock — they hold it.
  Lot availability for new bookings reads:

      sum(placements.qty) - sum(active bookings)

  so two operators booking the same lot at the same time can't
  over-reserve it.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Items.Item
  alias Backend.Production.ManufacturingOrder
  alias Backend.Purchasing.PurchaseOrderLine
  alias Backend.Stock.Lot, as: StockLot
  alias Backend.Warehouses.StorageCell

  @statuses ~w(requested consumed cancelled)
  def statuses, do: @statuses

  schema "manufacturing_order_bookings" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :quantity, :decimal
    field :consumed_quantity, :decimal, default: Decimal.new("0")
    field :status, :string, default: "requested"
    field :note, :string

    # Set when the picker has scanned both the cell + lot for this
    # booking and tapped Mark Picked. Lot is logically still at its
    # original cell (no Stock.Movement emitted) — physically it's on
    # the picker's trolley. Cleared on Abort Pickup; the eventual
    # confirm-transfer emits the actual move movement.
    field :picked_at, :utc_datetime

    # Pre-production receipt check. Stamped by a PRODUCTION operator
    # (different role from the picker) after they weigh / count the
    # physical lot at the production-feed cell. `received_qty` is the
    # actually-measured value — usually equal to `quantity` but stored
    # separately so qty drift is queryable for traceability. The MO
    # can't transition to "in_progress" until every raw-material /
    # packaging booking has `received_at` set.
    field :received_at, :utc_datetime
    field :received_qty, :decimal
    field :received_notes, :string

    # Production closeout — the production worker's hand-off step.
    # `consumed_at` is stamped once they've scanned the booked lot at
    # the production-feed cell, recorded how much was actually used
    # (0 = fully consumed, any remainder is physically moved to a
    # production-side dispatch cell via a `move` movement), photo'd
    # the lot, and submitted. The warehouse team's "pickup from
    # production" flow takes it from the dispatch cell back to
    # warehouse storage — that's a separate step, not this one.
    field :consumed_at, :utc_datetime

    belongs_to :company, Company
    belongs_to :manufacturing_order, ManufacturingOrder
    belongs_to :item, Item
    belongs_to :stock_lot, StockLot
    # Placeholder booking — reservation against an in-flight PO line
    # for which no lot exists yet (goods haven't landed). Mutually
    # exclusive with `stock_lot_id`: a booking is either a real
    # reservation against a lot OR a forward reservation against a
    # PO line. On QC pass of the lot produced by that PO receipt,
    # the placeholder auto-upgrades: stock_lot_id set,
    # purchase_order_line_id cleared. See
    # `Backend.Production.upgrade_placeholder_bookings_for_lot/2`.
    belongs_to :purchase_order_line, PurchaseOrderLine
    belongs_to :storage_cell, StorageCell
    belongs_to :picked_by, User
    belongs_to :received_by, User
    belongs_to :consumed_by, User
    belongs_to :created_by, User
    belongs_to :updated_by, User

    timestamps(type: :utc_datetime)
  end

  @cast_fields ~w(
    company_id manufacturing_order_id item_id stock_lot_id storage_cell_id
    purchase_order_line_id
    quantity consumed_quantity status note
    picked_at picked_by_id
    received_at received_by_id received_qty received_notes
    consumed_at consumed_by_id
    created_by_id updated_by_id
  )a

  def changeset(booking, attrs) do
    booking
    |> cast(attrs, @cast_fields)
    |> validate_required([
      :company_id,
      :manufacturing_order_id,
      :item_id,
      :quantity
    ])
    |> validate_lot_xor_po_line()
    |> validate_number(:quantity, greater_than: 0)
    |> validate_non_negative(:consumed_quantity)
    |> validate_inclusion(:status, @statuses)
    |> validate_length(:note, max: 500)
    |> validate_length(:received_notes, max: 2000)
    |> validate_received_qty()
    |> assoc_constraint(:company)
    |> assoc_constraint(:manufacturing_order)
    |> assoc_constraint(:item)
    |> assoc_constraint(:stock_lot)
    |> assoc_constraint(:purchase_order_line)
    |> assoc_constraint(:storage_cell)
    |> check_constraint(:quantity,
      name: :mo_bookings_quantity_positive,
      message: "must be greater than zero"
    )
    |> check_constraint(:status,
      name: :mo_bookings_status_known,
      message: "must be requested, consumed, or cancelled"
    )
    |> check_constraint(:stock_lot_id,
      name: :mo_bookings_lot_xor_po_line,
      message:
        "booking must point at either a stock lot or an open PO line (never both, never neither)"
    )
  end

  # XOR — exactly one of stock_lot_id / purchase_order_line_id must be
  # set. Mirrors the DB check constraint so the operator gets a clean
  # validation message instead of a 500.
  defp validate_lot_xor_po_line(cs) do
    lot = get_field(cs, :stock_lot_id)
    po_line = get_field(cs, :purchase_order_line_id)

    cond do
      not is_nil(lot) and not is_nil(po_line) ->
        add_error(cs, :stock_lot_id, "can't be set at the same time as purchase_order_line_id")

      is_nil(lot) and is_nil(po_line) ->
        add_error(cs, :stock_lot_id, "must reference either a stock lot or an open PO line")

      true ->
        cs
    end
  end

  defp validate_non_negative(cs, field) do
    case get_field(cs, field) do
      nil ->
        cs

      %Decimal{} = d ->
        if Decimal.compare(d, Decimal.new("0")) == :lt do
          add_error(cs, field, "must be zero or greater")
        else
          cs
        end

      _ ->
        cs
    end
  end

  # `received_qty` must be > 0 when set. Allowing zero would mean the
  # operator marked the booking received but counted nothing — that's
  # always a mistake (use status="cancelled" for "didn't arrive").
  defp validate_received_qty(cs) do
    case get_field(cs, :received_qty) do
      nil ->
        cs

      %Decimal{} = d ->
        if Decimal.compare(d, Decimal.new("0")) != :gt do
          add_error(cs, :received_qty, "must be greater than zero")
        else
          cs
        end

      _ ->
        cs
    end
  end

end
