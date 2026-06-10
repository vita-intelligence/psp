defmodule Backend.Vendors.ApprovedItem do
  @moduledoc """
  Edge of the vendor↔item approved-supplier graph. A PO line that
  references `vendor_id` + `item_id` validates against this table —
  if there's no matching row, the line is rejected before the PO
  can move out of draft.

  `approved_at` / `approved_by_id` mirror the ESIGN snapshot pattern
  the rest of the platform uses for "who said yes, when".
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Items.Item
  alias Backend.Vendors.Vendor

  schema "vendor_approved_items" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :approved_at, :utc_datetime
    field :notes, :string

    belongs_to :vendor, Vendor
    belongs_to :item, Item
    belongs_to :company, Company
    belongs_to :approved_by, User

    timestamps(type: :utc_datetime)
  end

  def changeset(row, attrs) do
    row
    |> cast(attrs, [
      :vendor_id,
      :item_id,
      :company_id,
      :approved_by_id,
      :approved_at,
      :notes
    ])
    |> validate_required([:vendor_id, :item_id, :company_id])
    |> validate_length(:notes, max: 2000)
    |> unique_constraint([:vendor_id, :item_id],
      name: :vendor_approved_items_vendor_item_index,
      message: "vendor already approved for this item"
    )
  end
end
