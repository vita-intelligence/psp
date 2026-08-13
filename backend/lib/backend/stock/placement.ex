defmodule Backend.Stock.Placement do
  @moduledoc """
  Where a lot physically sits. One row per (lot, cell). qty is
  current on-hand at that cell; movements mutate it and append the
  immutable audit trail.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Companies.Company
  alias Backend.Stock.Lot
  alias Backend.Warehouses.StorageCell

  schema "stock_lot_placements" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :qty, :decimal, default: Decimal.new(0)

    # Stamped when a closeout decides to leave the leftover at the
    # production_feed cell (``keep_in_place`` route choice). Nil for
    # every other placement — placements at regular / quarantine /
    # dispatch cells never carry this. Cleared to nil when the
    # placement is drained (fully consumed) or moved out via
    # return-pickup. Powers the "stranded at production" dashboard
    # query: ``kept_at IS NOT NULL AND kept_at < now() - N hours``.
    field :kept_at, :utc_datetime

    belongs_to :company, Company
    belongs_to :stock_lot, Lot
    belongs_to :storage_cell, StorageCell

    timestamps(type: :utc_datetime)
  end

  def changeset(placement, attrs) do
    placement
    |> cast(attrs, [
      :uuid,
      :company_id,
      :stock_lot_id,
      :storage_cell_id,
      :qty,
      :kept_at
    ])
    |> validate_required([:company_id, :stock_lot_id, :storage_cell_id, :qty])
    |> validate_number(:qty, greater_than_or_equal_to: 0)
    |> unique_constraint([:stock_lot_id, :storage_cell_id],
      name: :stock_lot_placements_lot_cell_index
    )
  end
end
