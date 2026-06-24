defmodule Backend.CustomerOrders.CustomerApprovedItem do
  @moduledoc """
  Per-customer approved-products row — the sell-side mirror of
  `Backend.Vendors.ApprovedItem`.

  Semantics: ABSENT rows mean "no restriction" (customer can buy
  anything). PRESENT rows narrow the catalogue down to only the
  listed items. Enforced at CO submit time via
  `Backend.CustomerOrders.customer_can_sell_item?/2`.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Customers.Customer
  alias Backend.CustomerOrders.CustomerApprovedItem
  alias Backend.Items.Item

  schema "customer_approved_items" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :approved_at, :utc_datetime
    field :notes, :string

    belongs_to :customer, Customer
    belongs_to :item, Item
    belongs_to :company, Company
    belongs_to :approved_by, User

    timestamps(type: :utc_datetime)
  end

  def changeset(%CustomerApprovedItem{} = row, attrs) do
    row
    |> cast(attrs, [
      :customer_id,
      :item_id,
      :company_id,
      :approved_by_id,
      :approved_at,
      :notes
    ])
    |> validate_required([:customer_id, :item_id, :company_id])
    |> validate_length(:notes, max: 2000)
    |> unique_constraint([:customer_id, :item_id],
      name: :customer_approved_items_customer_item_index,
      message: "this item is already on the approved list"
    )
  end
end
