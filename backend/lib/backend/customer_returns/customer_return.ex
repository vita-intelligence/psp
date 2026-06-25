defmodule Backend.CustomerReturns.CustomerReturn do
  @moduledoc """
  One RMA (Return Material Authorization). Header + state machine.
  Lines + file evidence live in their own tables.

  Display code (`RMA00001`, …) rendered from `id` + the company's
  numbering format.

  Identity columns (customer_id, customer_invoice_id) are cast here
  but the context's `update_header/3` rejects edits once the RMA
  leaves draft.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Customers.Customer
  alias Backend.CustomerInvoices.CustomerInvoice
  alias Backend.CustomerReturns.{CustomerReturn, CustomerReturnFile, CustomerReturnLine}

  @statuses ~w(draft received accepted rejected cancelled)

  schema "customer_returns" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :status, :string, default: "draft"

    field :return_date, :date
    field :reason_summary, :string
    field :notes, :string

    field :received_at, :utc_datetime
    field :resolved_at, :utc_datetime
    field :cancelled_at, :utc_datetime
    field :cancellation_reason, :string
    field :rejection_reason, :string

    belongs_to :customer, Customer
    belongs_to :customer_invoice, CustomerInvoice
    belongs_to :company, Company
    belongs_to :created_by, User
    belongs_to :updated_by, User
    belongs_to :received_by, User
    belongs_to :resolved_by, User
    belongs_to :cancelled_by, User

    has_many :lines, CustomerReturnLine, foreign_key: :customer_return_id
    has_many :files, CustomerReturnFile, foreign_key: :customer_return_id

    # Set by `Backend.CustomerInvoices.create_credit_note_from_rma/2`
    # — points at the credit-note invoice this RMA generated. Only
    # populated when status moves to `accepted`. The query is
    # one-shot via assoc on the FE; we don't preload by default.

    timestamps(type: :utc_datetime)
  end

  def statuses, do: @statuses

  def changeset(%CustomerReturn{} = ret, attrs) do
    ret
    |> cast(attrs, [
      :company_id,
      :customer_id,
      :customer_invoice_id,
      :return_date,
      :reason_summary,
      :notes,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:company_id, :customer_id, :return_date])
    |> validate_length(:reason_summary, max: 240)
    |> validate_length(:notes, max: 4000)
  end

  def transition_status_changeset(%CustomerReturn{} = ret, attrs) do
    ret
    |> cast(attrs, [
      :status,
      :received_at,
      :received_by_id,
      :resolved_at,
      :resolved_by_id,
      :cancelled_at,
      :cancelled_by_id,
      :cancellation_reason,
      :rejection_reason,
      :updated_by_id
    ])
    |> validate_required([:status])
    |> validate_inclusion(:status, @statuses)
  end
end
