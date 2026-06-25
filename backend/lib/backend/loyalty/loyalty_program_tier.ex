defmodule Backend.Loyalty.LoyaltyProgramTier do
  @moduledoc """
  One threshold inside a `LoyaltyProgram`. When a customer's basis
  metric (V1: YTD paid revenue in base currency) crosses
  `min_threshold`, this tier's `rate_pct` cashback applies — granted
  as a `customer_credits` row of kind `rebate_accrual`.

  Tiers are ordered by `min_threshold ASC` at query time so editing
  the cosmetic `rank` field doesn't desync the math.

  Validation:
    * `min_threshold` >= 0
    * `rate_pct` in [0, 100]
    * thresholds within a program are de-duplicated server-side
      (context enforces uniqueness when adding / editing)
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Loyalty.{LoyaltyProgram, LoyaltyProgramTier}

  schema "loyalty_program_tiers" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :rank, :integer, default: 0
    field :min_threshold, :decimal, default: Decimal.new(0)
    field :rate_pct, :decimal, default: Decimal.new(0)
    field :label, :string

    belongs_to :loyalty_program, LoyaltyProgram

    timestamps(type: :utc_datetime)
  end

  def changeset(%LoyaltyProgramTier{} = tier, attrs) do
    tier
    |> cast(attrs, [:loyalty_program_id, :rank, :min_threshold, :rate_pct, :label])
    |> validate_required([:loyalty_program_id, :min_threshold, :rate_pct])
    |> validate_number(:min_threshold, greater_than_or_equal_to: 0)
    |> validate_number(:rate_pct,
      greater_than_or_equal_to: 0,
      less_than_or_equal_to: 100
    )
    |> validate_length(:label, max: 60)
  end
end
