defmodule Backend.Customers.CustomerContact do
  @moduledoc """
  A single phone / mobile / email / fax row attached to a customer.

  We model this as a separate table (rather than the MRPEasy
  pattern of one phone column on the customer) because a real
  customer has multiple touch points — Sales line, Accounts AP,
  Goods-In, out-of-hours. The label column carries the human-
  readable role ("Accounts", "Warehouse Manager") so the salesperson
  knows which line to ring without opening a separate Contacts page.

  At most one row per customer can have `is_primary = true` — the
  primary contact is the default fill on COs / invoices.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Customers.{Customer, CustomerContact}

  @kinds ~w(phone mobile email fax other)

  schema "customer_contacts" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :kind, :string
    field :value, :string
    field :label, :string
    field :is_primary, :boolean, default: false

    belongs_to :customer, Customer
    belongs_to :company, Company
    belongs_to :created_by, User
    belongs_to :updated_by, User

    timestamps(type: :utc_datetime)
  end

  def kinds, do: @kinds

  def changeset(%CustomerContact{} = contact, attrs) do
    contact
    |> cast(attrs, [
      :customer_id,
      :company_id,
      :kind,
      :value,
      :label,
      :is_primary,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:customer_id, :company_id, :kind, :value])
    |> validate_inclusion(:kind, @kinds)
    |> validate_length(:value, min: 1, max: 200)
    |> validate_length(:label, max: 60)
    |> validate_kind_value()
  end

  # Email rows get RFC-shaped validation; phone/mobile/fax get a
  # permissive numeric+separator check (full E.164 normalisation
  # happens at the context layer where we can call libphonenumber-
  # style helpers).
  defp validate_kind_value(changeset) do
    case get_field(changeset, :kind) do
      "email" ->
        validate_format(changeset, :value, ~r/^[^\s@]+@[^\s@]+\.[^\s@]+$/,
          message: "invalid email"
        )

      kind when kind in ["phone", "mobile", "fax"] ->
        validate_format(changeset, :value, ~r/^[\d\s+\-().]{4,}$/,
          message: "must be a phone number"
        )

      _ ->
        changeset
    end
  end
end
