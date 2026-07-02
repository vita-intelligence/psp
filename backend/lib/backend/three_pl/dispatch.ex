defmodule Backend.ThreePL.Dispatch do
  @moduledoc """
  One outbound send-out of a bailee lot, split into two lifecycle
  steps:

    1. **Request** (desktop). Desktop operator types qty + optional
       reference / notes and confirms. Row is inserted with
       `status = "pending"`, `requested_by_id` + `requested_at`
       stamped, evidence fields left null. No Stock.Movement fires.

    2. **Complete** (mobile). Warehouse picker scans the source
       three_pl_storage cell + the lot QR to confirm the pick,
       walks the qty to the shipping bay, scans the destination
       dispatch cell + takes a photo, confirms. THAT step flips
       `status = "completed"`, populates `dispatched_by_id`,
       `dispatched_at`, `photo_url`, and writes the physical
       Stock.Movement in the same transaction.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Stock.Lot

  @statuses ~w(pending completed cancelled)
  def statuses, do: @statuses

  schema "three_pl_dispatches" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :qty, :decimal
    field :reference, :string
    field :notes, :string
    field :photo_url, :string
    field :status, :string, default: "pending"

    # Request half — desktop.
    field :requested_at, :utc_datetime
    # Completion half — mobile.
    field :dispatched_at, :utc_datetime

    belongs_to :company, Company
    belongs_to :stock_lot, Lot
    belongs_to :requested_by, User, foreign_key: :requested_by_id
    belongs_to :dispatched_by, User, foreign_key: :dispatched_by_id

    timestamps(type: :utc_datetime)
  end

  @doc """
  Desktop dispatch request. Qty + optional reference/notes; no photo
  yet. Backend adds status = "pending" + requested_at + requested_by
  in `Backend.ThreePL.request_dispatch/2`.
  """
  def request_changeset(row, attrs) do
    row
    |> cast(attrs, [
      :company_id,
      :stock_lot_id,
      :qty,
      :reference,
      :notes,
      :status,
      :requested_by_id,
      :requested_at
    ])
    |> validate_required([
      :company_id,
      :stock_lot_id,
      :qty,
      :status,
      :requested_by_id,
      :requested_at
    ])
    |> validate_inclusion(:status, @statuses)
    |> validate_number(:qty, greater_than: 0)
    |> validate_length(:reference, max: 200)
  end

  @doc """
  Mobile completion. Populates photo evidence + completion stamps.
  Backend enforces the status transition (pending → completed) in
  `Backend.ThreePL.complete_dispatch/3`.
  """
  def completion_changeset(row, attrs) do
    row
    |> cast(attrs, [
      :status,
      :photo_url,
      :dispatched_by_id,
      :dispatched_at
    ])
    |> validate_required([:status, :dispatched_by_id, :dispatched_at])
    |> validate_inclusion(:status, ~w(completed cancelled))
    |> validate_length(:photo_url, max: 500)
  end
end
