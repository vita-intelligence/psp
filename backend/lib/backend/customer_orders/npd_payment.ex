defmodule Backend.CustomerOrders.NpdPayment do
  @moduledoc """
  One NPD `Payment` mirrored onto a PSP `CustomerOrder`.

  Populated by `Backend.CustomerOrders.NpdSync` on every
  formulation-save push from vita-cff. PSP is a read-mirror — no
  operator ever edits these rows directly; the sync writer inserts /
  updates / deletes so the local state matches whatever NPD says the
  finance queue looks like right now.

  The identity key is `(customer_order_id, npd_payment_id)` — the
  unique index in the migration guards it. `sync_payments/2` upserts
  by that pair and deletes any local row NOT present in the fresh
  payload so a payment voided-then-deleted on NPD disappears here on
  the next sync.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.CustomerOrders.CustomerOrder

  schema "customer_order_npd_payments" do
    belongs_to :customer_order, CustomerOrder
    field :npd_payment_id, Ecto.UUID
    field :kind, :string
    field :amount, :decimal
    field :currency, :string
    field :status, :string
    field :invoice_number, :string
    field :paid_at, :utc_datetime
    field :files, {:array, :map}, default: []
    field :synced_at, :utc_datetime

    timestamps(type: :utc_datetime)
  end

  @required ~w(customer_order_id npd_payment_id kind status synced_at)a
  @optional ~w(amount currency invoice_number paid_at files)a

  def changeset(row, attrs) do
    row
    |> cast(attrs, @required ++ @optional)
    |> validate_required(@required)
    |> unique_constraint(
      :npd_payment_id,
      name: :customer_order_npd_payments_co_payment_uidx
    )
  end
end
