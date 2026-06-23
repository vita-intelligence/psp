defmodule Backend.Warehouses.ReturnPick do
  @moduledoc """
  One row per (lot, return-pickup attempt). Tracks the warehouse
  worker's trolley state while a lot is in flight from a
  production-side dispatch cell back to warehouse storage.

  Lifecycle:

    * `on_trolley` — `picked_at` set, `placed_at` is null. The lot is
      physically off the dispatch cell and on the worker's trolley.
      Other warehouse workers can't claim the same lot — the partial
      unique index on `stock_lot_id WHERE placed_at IS NULL` enforces
      this server-side.

    * `placed` — `placed_at` set (alongside `placed_by_id`,
      `placed_to_cell_id`, and the place-down photo). Row is archived;
      lot is back in warehouse storage and `status=available`.

  See `Backend.Warehouses.ReturnPickup` for the action layer that
  creates and finalises these rows.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Stock.Lot
  alias Backend.Warehouses.StorageCell

  schema "warehouse_return_picks" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :qty, :decimal

    field :picked_at, :utc_datetime
    field :picked_photo_url, :string

    field :placed_at, :utc_datetime
    field :placed_photo_url, :string

    belongs_to :company, Company
    belongs_to :stock_lot, Lot
    belongs_to :picked_from_cell, StorageCell
    belongs_to :picked_by, User
    belongs_to :placed_to_cell, StorageCell
    belongs_to :placed_by, User

    timestamps(type: :utc_datetime)
  end

  @doc """
  Insert changeset — used when the worker scans a lot off a dispatch
  cell onto their trolley. `placed_*` is always null at creation.
  """
  def pick_changeset(%__MODULE__{} = pick, attrs) do
    pick
    |> cast(attrs, [
      :company_id,
      :stock_lot_id,
      :picked_from_cell_id,
      :picked_by_id,
      :picked_at,
      :picked_photo_url,
      :qty
    ])
    |> validate_required([
      :company_id,
      :stock_lot_id,
      :picked_from_cell_id,
      :picked_by_id,
      :picked_at,
      :qty
    ])
    |> validate_number(:qty, greater_than: 0)
    |> assoc_constraint(:company)
    |> assoc_constraint(:stock_lot)
    |> assoc_constraint(:picked_from_cell)
    |> assoc_constraint(:picked_by)
    |> unique_constraint(:stock_lot_id,
      name: :warehouse_return_picks_open_lot_idx,
      message: "already on a warehouse trolley"
    )
  end

  @doc """
  Place-down changeset — stamps `placed_at`, `placed_by_id`,
  `placed_to_cell_id`, optional photo URL. The DB check constraint
  enforces the all-four-set invariant.
  """
  def place_changeset(%__MODULE__{} = pick, attrs) do
    pick
    |> cast(attrs, [
      :placed_at,
      :placed_by_id,
      :placed_to_cell_id,
      :placed_photo_url
    ])
    |> validate_required([:placed_at, :placed_by_id, :placed_to_cell_id])
    |> assoc_constraint(:placed_to_cell)
    |> assoc_constraint(:placed_by)
  end
end
