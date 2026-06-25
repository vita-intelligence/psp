defmodule Backend.Loyalty.LoyaltyProgram do
  @moduledoc """
  Named loyalty scheme — a rule set that grants credits to customers
  who hit revenue tiers. V1 only ships `scheme = "tiered_rebate"` on
  `basis = "ytd_revenue"` paying out as `payout_kind = "credit"`. The
  enums leave room for `flat_rate` / `lifetime_revenue` / `refund`
  layered on later without a schema change.

  Tiers live in a child table — see
  `Backend.Loyalty.LoyaltyProgramTier`.

  Lifecycle:
    * `is_active = true` programs can be assigned to customers and
      accrue credits. Flipping `false` stops new accrual but does
      NOT void existing ledger rows — credits already earned stay.
    * `is_default = true` flags one program per company as the
      default assignment for new customers. The context enforces
      single-default-per-company.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Loyalty.{LoyaltyProgram, LoyaltyProgramTier}

  @schemes ~w(tiered_rebate)
  @bases ~w(ytd_revenue)
  @payout_kinds ~w(credit)

  schema "loyalty_programs" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :name, :string
    field :description, :string

    field :scheme, :string, default: "tiered_rebate"
    field :basis, :string, default: "ytd_revenue"
    field :payout_kind, :string, default: "credit"

    field :is_active, :boolean, default: true
    field :is_default, :boolean, default: false

    field :activated_at, :utc_datetime
    field :deactivated_at, :utc_datetime
    field :deactivation_reason, :string

    belongs_to :company, Company
    belongs_to :created_by, User
    belongs_to :updated_by, User

    has_many :tiers, LoyaltyProgramTier,
      foreign_key: :loyalty_program_id,
      preload_order: [asc: :min_threshold]

    timestamps(type: :utc_datetime)
  end

  def schemes, do: @schemes
  def bases, do: @bases
  def payout_kinds, do: @payout_kinds

  @doc """
  Identity + description editable any time. The state-affecting
  flags (`is_active`, `is_default`) move through dedicated context
  functions so audit stamps capture *why*.
  """
  def changeset(%LoyaltyProgram{} = program, attrs) do
    program
    |> cast(attrs, [
      :company_id,
      :name,
      :description,
      :scheme,
      :basis,
      :payout_kind,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:company_id, :name, :scheme, :basis, :payout_kind])
    |> validate_inclusion(:scheme, @schemes)
    |> validate_inclusion(:basis, @bases)
    |> validate_inclusion(:payout_kind, @payout_kinds)
    |> validate_length(:name, min: 1, max: 120)
    |> validate_length(:description, max: 2_000)
  end

  @doc "Flip is_active. `false` stamps deactivated_at + reason."
  def lifecycle_changeset(%LoyaltyProgram{} = program, attrs) do
    program
    |> cast(attrs, [
      :is_active,
      :activated_at,
      :deactivated_at,
      :deactivation_reason,
      :updated_by_id
    ])
    |> maybe_require_reason()
  end

  defp maybe_require_reason(changeset) do
    case get_change(changeset, :is_active) do
      false ->
        changeset
        |> validate_required([:deactivation_reason],
          message: "is required when deactivating a program"
        )
        |> validate_length(:deactivation_reason, min: 5, max: 500)

      _ ->
        changeset
    end
  end

  @doc "Flip is_default. Caller is responsible for unsetting other rows."
  def default_changeset(%LoyaltyProgram{} = program, attrs) do
    program
    |> cast(attrs, [:is_default, :updated_by_id])
  end
end
