defmodule Backend.Purchasing.PurchaseOrderApproval do
  @moduledoc """
  ESIGN snapshot for one approval tier on a PO. Each PO needs both
  an `approver` signature and a `director` signature before it can
  reach `approved`.

  Stored as its own row so the audit log keeps the signature even
  after the PO moves into `ordered`/`received` downstream.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Purchasing.PurchaseOrder

  @kinds ~w(approver director)

  schema "purchase_order_approvals" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :kind, :string
    field :signed_at, :utc_datetime
    field :notes, :string
    field :signature_image, :string

    belongs_to :purchase_order, PurchaseOrder
    belongs_to :signed_by, User
    belongs_to :company, Company

    timestamps(type: :utc_datetime)
  end

  def kinds, do: @kinds

  def changeset(row, attrs) do
    row
    |> cast(attrs, [
      :purchase_order_id,
      :company_id,
      :signed_by_id,
      :kind,
      :signed_at,
      :notes,
      :signature_image
    ])
    |> validate_required([
      :purchase_order_id,
      :company_id,
      :signed_by_id,
      :kind,
      :signed_at
    ])
    |> validate_inclusion(:kind, @kinds)
    |> validate_length(:notes, max: 4000)
    |> unique_constraint([:purchase_order_id, :kind],
      name: :purchase_order_approvals_po_kind_index,
      message: "already signed at this tier"
    )
  end
end
