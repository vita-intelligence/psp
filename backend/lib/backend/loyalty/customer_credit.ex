defmodule Backend.Loyalty.CustomerCredit do
  @moduledoc """
  One row in the customer credits ledger. Append-only by intent —
  corrections happen via a new opposite-sign row (with a
  `reason` referencing the corrected event), so the audit trail
  reads chronologically and never silently mutates history.

  Kinds:
    * `rebate_accrual` — auto-granted when a customer crosses a
      loyalty program tier. Always positive. Set
      `loyalty_program_id`, `loyalty_program_tier_id`, and
      `source_invoice_id` (the invoice whose payment triggered it).
    * `manual_grant` — admin gift (apology, goodwill, custom
      arrangement). Always positive. Requires `reason` + non-nil
      `granted_by_id`.
    * `applied_to_invoice` — redemption against a future invoice.
      Always negative. Set `credit_note_invoice_id` to the matching
      credit-note invoice (created by the same context call so A/R
      math stays consistent).

  Balance is `sum(amount)` across all rows for a customer — never
  persisted on the customer row.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.CustomerInvoices.CustomerInvoice
  alias Backend.Customers.Customer
  alias Backend.Loyalty.{CustomerCredit, LoyaltyProgram, LoyaltyProgramTier}

  @kinds ~w(rebate_accrual manual_grant applied_to_invoice)

  schema "customer_credits" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :kind, :string
    field :amount, :decimal
    field :currency_code, :string
    field :reason, :string

    belongs_to :company, Company
    belongs_to :customer, Customer
    belongs_to :loyalty_program, LoyaltyProgram
    belongs_to :loyalty_program_tier, LoyaltyProgramTier
    belongs_to :source_invoice, CustomerInvoice
    belongs_to :credit_note_invoice, CustomerInvoice
    belongs_to :granted_by, User

    timestamps(type: :utc_datetime)
  end

  def kinds, do: @kinds

  def changeset(%CustomerCredit{} = credit, attrs) do
    credit
    |> cast(attrs, [
      :company_id,
      :customer_id,
      :kind,
      :amount,
      :currency_code,
      :reason,
      :loyalty_program_id,
      :loyalty_program_tier_id,
      :source_invoice_id,
      :credit_note_invoice_id,
      :granted_by_id
    ])
    |> validate_required([:company_id, :customer_id, :kind, :amount, :currency_code])
    |> validate_inclusion(:kind, @kinds)
    |> validate_amount_nonzero()
    |> validate_amount_sign_matches_kind()
    |> validate_reason_for_kind()
    |> validate_length(:reason, max: 1_000)
    |> validate_length(:currency_code, is: 3)
  end

  defp validate_amount_nonzero(changeset) do
    case get_field(changeset, :amount) do
      %Decimal{} = a ->
        if Decimal.compare(a, Decimal.new(0)) == :eq do
          add_error(changeset, :amount, "must not be zero")
        else
          changeset
        end

      _ ->
        changeset
    end
  end

  defp validate_amount_sign_matches_kind(changeset) do
    case {get_field(changeset, :kind), get_field(changeset, :amount)} do
      {kind, %Decimal{} = amount} when kind in ["rebate_accrual", "manual_grant"] ->
        if Decimal.compare(amount, Decimal.new(0)) == :gt do
          changeset
        else
          add_error(changeset, :amount, "must be positive for #{kind}")
        end

      {"applied_to_invoice", %Decimal{} = amount} ->
        if Decimal.compare(amount, Decimal.new(0)) == :lt do
          changeset
        else
          add_error(changeset, :amount, "must be negative for applied_to_invoice")
        end

      _ ->
        changeset
    end
  end

  defp validate_reason_for_kind(changeset) do
    case {get_field(changeset, :kind), get_field(changeset, :reason)} do
      {"manual_grant", reason} when is_nil(reason) or reason == "" ->
        add_error(changeset, :reason, "is required for manual grants")

      _ ->
        changeset
    end
  end
end
