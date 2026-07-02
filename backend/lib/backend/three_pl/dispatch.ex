defmodule Backend.ThreePL.Dispatch do
  @moduledoc """
  One outbound send-out of a bailee lot. Partial-lot: the operator
  enters the qty being shipped and attaches a photo of the packages
  on the trolley / dock, plus an optional carrier / customer PO
  reference for traceability.

  Records the who + when + how-much + evidence in one row. The
  transactional companion is a `Backend.Stock.Movement` from the
  lot's three_pl_storage placement to a dispatch cell for the same
  qty — see `Backend.ThreePL.dispatch/2`.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Stock.Lot

  @required ~w(company_id stock_lot_id qty dispatched_at)a
  @optional ~w(reference notes photo_url dispatched_by_id)a

  schema "three_pl_dispatches" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :qty, :decimal
    field :reference, :string
    field :notes, :string
    field :photo_url, :string
    field :dispatched_at, :utc_datetime

    belongs_to :company, Company
    belongs_to :stock_lot, Lot
    belongs_to :dispatched_by, User

    timestamps(type: :utc_datetime)
  end

  def changeset(row, attrs) do
    row
    |> cast(attrs, @required ++ @optional)
    |> validate_required(@required)
    |> validate_number(:qty, greater_than: 0)
    |> validate_length(:reference, max: 200)
    |> validate_length(:photo_url, max: 500)
  end
end
