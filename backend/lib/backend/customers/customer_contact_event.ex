defmodule Backend.Customers.CustomerContactEvent do
  @moduledoc """
  A single touch point with a customer — a call placed, an email
  sent, a meeting held, a message exchanged. Inserted via the
  "Log contact" action button on the customer detail page.

  This table is the source of truth that derives:

    * `customers.last_contact_at` (= max occurred_at)
    * `customers.next_contact_at` (= last_contact_at + frequency)
    * `customers.contact_started_at` (= min occurred_at)
    * the projected `status` (lead → prospect → active → dormant)
    * the "Today's contacts" CRM tab (where occurred_at::date = today
      OR next_contact_at::date = today)

  Append-only by intent — `update` and `delete` aren't exposed by
  the context. A "wrong entry" is corrected with a follow-up event
  carrying a corrective summary, not by mutating history.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Customers.{Customer, CustomerContactEvent}

  @kinds ~w(call email meeting message note other)

  schema "customer_contact_events" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :kind, :string
    field :occurred_at, :utc_datetime
    field :summary, :string

    belongs_to :customer, Customer
    belongs_to :company, Company
    belongs_to :logged_by, User

    timestamps(type: :utc_datetime)
  end

  def kinds, do: @kinds

  def changeset(%CustomerContactEvent{} = event, attrs) do
    event
    |> cast(attrs, [
      :customer_id,
      :company_id,
      :kind,
      :occurred_at,
      :summary,
      :logged_by_id
    ])
    |> validate_required([:customer_id, :company_id, :kind, :occurred_at])
    |> validate_inclusion(:kind, @kinds)
    |> validate_length(:summary, max: 4_000)
  end
end
