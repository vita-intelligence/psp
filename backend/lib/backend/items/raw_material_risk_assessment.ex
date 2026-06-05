defmodule Backend.Items.RawMaterialRiskAssessment do
  @moduledoc """
  TACCP/VACCP/HACCP scorecard for a raw-material item. 1:1 with
  `items`. Computed overall level is derived from the seven scores
  via the max-based rule in `compute_overall_level/1`; the override
  is opt-in and requires a justification.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Items.Item

  @primary_key {:item_id, :id, autogenerate: false}
  @foreign_key_type :id

  @levels ~w(low medium high critical)

  schema "item_raw_material_risk_assessment" do
    field :physical_risk_score, :integer
    field :chemical_risk_score, :integer
    field :biological_risk_score, :integer
    field :allergen_risk_score, :integer
    field :radiological_risk_score, :integer
    field :fraud_vulnerability_score, :integer
    field :malicious_risk_score, :integer
    field :computed_overall_level, :string
    field :overridden_overall_level, :string
    field :override_justification, :string
    field :justification, :string
    field :required_controls, :string
    field :assessed_at, :utc_datetime

    belongs_to :item, Item, primary_key: true, define_field: false
    belongs_to :assessed_by, User

    timestamps(type: :utc_datetime)
  end

  @score_fields ~w(physical_risk_score chemical_risk_score biological_risk_score allergen_risk_score radiological_risk_score fraud_vulnerability_score malicious_risk_score)a

  def score_fields, do: @score_fields
  def levels, do: @levels

  def changeset(struct, attrs) do
    struct
    |> cast(attrs, [
      :item_id,
      :physical_risk_score,
      :chemical_risk_score,
      :biological_risk_score,
      :allergen_risk_score,
      :radiological_risk_score,
      :fraud_vulnerability_score,
      :malicious_risk_score,
      :overridden_overall_level,
      :override_justification,
      :justification,
      :required_controls,
      :assessed_at,
      :assessed_by_id
    ])
    |> validate_required([:item_id])
    |> validate_scores()
    |> validate_inclusion_if_set(:overridden_overall_level, @levels)
    |> validate_override_requires_justification()
    |> compute_overall()
  end

  defp validate_scores(changeset) do
    Enum.reduce(@score_fields, changeset, fn field, cs ->
      case get_field(cs, field) do
        nil -> cs
        n when is_integer(n) and n >= 0 and n <= 5 -> cs
        _ -> add_error(cs, field, "must be an integer between 0 and 5")
      end
    end)
  end

  defp validate_inclusion_if_set(changeset, field, choices) do
    case get_change(changeset, field) do
      nil -> changeset
      "" -> put_change(changeset, field, nil)
      _ ->
        validate_inclusion(changeset, field, choices,
          message: "must be one of: #{Enum.join(choices, ", ")}"
        )
    end
  end

  # If you override the computed level, you must say WHY. Regulatory
  # audits will ask.
  defp validate_override_requires_justification(changeset) do
    override = get_field(changeset, :overridden_overall_level)
    justification = get_field(changeset, :override_justification)

    cond do
      is_nil(override) -> changeset
      is_binary(justification) and String.trim(justification) != "" -> changeset
      true ->
        add_error(
          changeset,
          :override_justification,
          "required when you override the computed level"
        )
    end
  end

  # Max-of-scores → level mapping. 0..1 = low, 2 = medium, 3..4 = high,
  # 5 = critical. Conservative on the high side so audits don't catch
  # us downplaying.
  defp compute_overall(changeset) do
    scores =
      @score_fields
      |> Enum.map(&get_field(changeset, &1))
      |> Enum.reject(&is_nil/1)

    case scores do
      [] ->
        put_change(changeset, :computed_overall_level, nil)

      _ ->
        level =
          case Enum.max(scores) do
            n when n <= 1 -> "low"
            2 -> "medium"
            n when n <= 4 -> "high"
            _ -> "critical"
          end

        put_change(changeset, :computed_overall_level, level)
    end
  end

  @doc "Effective level — override if set, computed otherwise."
  def effective_level(%__MODULE__{
        overridden_overall_level: o,
        computed_overall_level: c
      }) do
    o || c
  end
end
