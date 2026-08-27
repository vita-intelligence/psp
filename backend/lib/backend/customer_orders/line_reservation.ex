defmodule Backend.CustomerOrders.LineReservation do
  @moduledoc """
  A logical earmark of a produced stock lot's quantity against a
  specific ``CustomerOrderLine``. Created automatically by
  ``Backend.Production.finish_mo_production`` on the surplus branch
  when an MO closes over the CO's ordered qty — the delta
  (``qty_ordered - qty_already_delivered``) is reserved on the fresh
  output lot, and the remaining balance flows into free stock as it
  would for any other lot.

  Reservations don't move stock; they cap what the dispatch flow
  will pull from a lot for a given CO line. Two consequences:

    * A picker pulling for a CO line with ``qty_reserved = 10_000``
      on an ``11_000``-unit lot will only stage 10_000; the 1_000
      surplus stays in the free cell.
    * A CO's fulfilment qty (``Backend.CustomerOrders.qty_delivered_for_line/1``)
      counts a reservation once its lot is dispatched, not before —
      the reservation itself is a claim, not a delivery.

  Deliberately narrow: one row = one lot × one CO line × one qty.
  Split reservations across multiple lots by inserting multiple
  rows. Deleted on CO line cancel via ``on_delete: :delete_all``.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.CustomerOrders.CustomerOrderLine
  alias Backend.Production.ManufacturingOrder
  alias Backend.Stock.Lot, as: StockLot

  @origins ~w(auto_surplus manual)
  def origins, do: @origins

  schema "co_line_lot_reservations" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :quantity, :decimal
    field :origin, :string, default: "auto_surplus"
    field :notes, :string

    belongs_to :company, Company
    belongs_to :customer_order_line, CustomerOrderLine
    belongs_to :stock_lot, StockLot
    belongs_to :manufacturing_order, ManufacturingOrder
    belongs_to :created_by, User
    belongs_to :updated_by, User

    timestamps(type: :utc_datetime)
  end

  def changeset(reservation, attrs) do
    reservation
    |> cast(attrs, [
      :company_id,
      :customer_order_line_id,
      :stock_lot_id,
      :manufacturing_order_id,
      :quantity,
      :origin,
      :notes,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([
      :company_id,
      :customer_order_line_id,
      :stock_lot_id,
      :quantity,
      :origin
    ])
    |> validate_number(:quantity, greater_than: 0)
    |> validate_inclusion(:origin, @origins,
      message: "must be one of: #{Enum.join(@origins, ", ")}"
    )
    |> validate_length(:notes, max: 2_000)
    |> assoc_constraint(:company)
    |> assoc_constraint(:customer_order_line)
    |> assoc_constraint(:stock_lot)
    |> assoc_constraint(:manufacturing_order)
    |> check_constraint(:quantity,
      name: :co_line_lot_reservations_qty_positive,
      message: "must be greater than zero"
    )
    |> check_constraint(:origin,
      name: :co_line_lot_reservations_origin_known,
      message: "must be a known origin"
    )
  end
end
