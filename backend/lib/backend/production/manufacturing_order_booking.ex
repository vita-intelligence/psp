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

    belongs_to :company, Company
    belongs_to :manufacturing_order, ManufacturingOrder
    belongs_to :item, Item
    belongs_to :stock_lot, StockLot
    belongs_to :storage_cell, StorageCell
    belongs_to :picked_by, User
    belongs_to :created_by, User
    belongs_to :updated_by, User

    timestamps(type: :utc_datetime)
  end

  @cast_fields ~w(
    company_id manufacturing_order_id item_id stock_lot_id storage_cell_id
    quantity consumed_quantity status note
    picked_at picked_by_id
    created_by_id updated_by_id
  )a

  def changeset(booking, attrs) do
    booking
    |> cast(attrs, @cast_fields)
    |> validate_required([
      :company_id,
      :manufacturing_order_id,
      :item_id,
      :stock_lot_id,
      :quantity
    ])
    |> validate_number(:quantity, greater_than: 0)
    |> validate_non_negative(:consumed_quantity)
    |> validate_consumed_le_quantity()
    |> validate_inclusion(:status, @statuses)
    |> validate_length(:note, max: 500)
    |> assoc_constraint(:company)
    |> assoc_constraint(:manufacturing_order)
    |> assoc_constraint(:item)
    |> assoc_constraint(:stock_lot)
    |> assoc_constraint(:storage_cell)
    |> check_constraint(:quantity,
      name: :mo_bookings_quantity_positive,
      message: "must be greater than zero"
    )
    |> check_constraint(:consumed_quantity,
      name: :mo_bookings_consumed_le_qty,
      message: "can't exceed booked quantity"
    )
    |> check_constraint(:status,
      name: :mo_bookings_status_known,
      message: "must be requested, consumed, or cancelled"
    )
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

  defp validate_consumed_le_quantity(cs) do
    case {get_field(cs, :consumed_quantity), get_field(cs, :quantity)} do
      {%Decimal{} = consumed, %Decimal{} = qty} ->
        if Decimal.compare(consumed, qty) == :gt do
          add_error(cs, :consumed_quantity, "can't exceed booked quantity")
        else
          cs
        end

      _ ->
        cs
    end
  end
end
