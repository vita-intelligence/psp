defmodule Backend.Items.RawMaterialCompliance do
  @moduledoc """
  Regulatory + sourcing metadata for a raw-material item. 1:1 with
  `items`. Held as a separate schema (not embedded) so the items
  payload stays the same shape for non-raw-material types.

  Every enum field is open to NULL — "not assessed yet" is a real
  state for a newly-created item, distinct from "definitively
  not applicable".
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Items.{Item, ItemFile}

  @primary_key {:item_id, :id, autogenerate: false}
  @foreign_key_type :id

  @use_as_choices ~w(active sweetener bulking_agent flavouring colour acidity_regulator glazing_agent gelling_agent emulsifier disintegrant stabiliser anti_caking coating preservative carrier excipient other)
  @allergen_statuses ~w(free contains_traces contains)
  @vegan_statuses ~w(vegan vegetarian non_vegetarian unknown)
  @halal_statuses ~w(certified not_certified not_applicable)
  @kosher_statuses ~w(certified not_certified not_applicable)
  @organic_statuses ~w(certified in_conversion non_organic not_applicable)
  @novel_food_statuses ~w(not_novel authorised pending not_authorised)
  @gmo_statuses ~w(gmo_free contains_gmo unknown)

  schema "item_raw_material_compliance" do
    field :use_as, :string
    field :allergen_status, :string
    field :vegan_status, :string
    field :halal_status, :string
    field :kosher_status, :string
    field :organic_status, :string
    field :novel_food_status, :string
    field :gmo_status, :string
    field :country_of_origin, :string
    field :purity_pct, :decimal
    field :extract_ratio, :string
    field :overage_pct, :decimal
    field :powder_water_dose_mg_per_ml, :decimal
    field :shelf_life_months, :integer
    field :storage_conditions, :string
    field :last_reviewed_at, :utc_datetime
    field :review_frequency_months, :integer
    field :review_due_at, :date

    belongs_to :item, Item, primary_key: true, define_field: false
    belongs_to :last_reviewed_by, User
    belongs_to :spec_document_file, ItemFile

    timestamps(type: :utc_datetime)
  end

  def use_as_choices, do: @use_as_choices
  def allergen_statuses, do: @allergen_statuses
  def vegan_statuses, do: @vegan_statuses
  def halal_statuses, do: @halal_statuses
  def kosher_statuses, do: @kosher_statuses
  def organic_statuses, do: @organic_statuses
  def novel_food_statuses, do: @novel_food_statuses
  def gmo_statuses, do: @gmo_statuses

  def changeset(struct, attrs) do
    struct
    |> cast(attrs, [
      :item_id,
      :use_as,
      :allergen_status,
      :vegan_status,
      :halal_status,
      :kosher_status,
      :organic_status,
      :novel_food_status,
      :gmo_status,
      :country_of_origin,
      :purity_pct,
      :extract_ratio,
      :overage_pct,
      :powder_water_dose_mg_per_ml,
      :shelf_life_months,
      :storage_conditions,
      :spec_document_file_id,
      :last_reviewed_at,
      :last_reviewed_by_id,
      :review_frequency_months,
      :review_due_at
    ])
    |> validate_required([:item_id])
    |> validate_inclusion_if_set(:use_as, @use_as_choices)
    |> validate_inclusion_if_set(:allergen_status, @allergen_statuses)
    |> validate_inclusion_if_set(:vegan_status, @vegan_statuses)
    |> validate_inclusion_if_set(:halal_status, @halal_statuses)
    |> validate_inclusion_if_set(:kosher_status, @kosher_statuses)
    |> validate_inclusion_if_set(:organic_status, @organic_statuses)
    |> validate_inclusion_if_set(:novel_food_status, @novel_food_statuses)
    |> validate_inclusion_if_set(:gmo_status, @gmo_statuses)
    |> validate_country_code()
    |> validate_decimal_in_range(:purity_pct, Decimal.new(0), Decimal.new(100))
    |> validate_decimal_in_range(:overage_pct, Decimal.new(0), Decimal.new(100))
    |> validate_number_if_set(:shelf_life_months, greater_than: 0)
    |> validate_number_if_set(:review_frequency_months, greater_than: 0)
    |> compute_review_due_at()
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

  # ISO 3166-1 alpha-2 — two upper-case letters.
  defp validate_country_code(changeset) do
    case get_change(changeset, :country_of_origin) do
      nil ->
        changeset

      "" ->
        put_change(changeset, :country_of_origin, nil)

      raw when is_binary(raw) ->
        normalised = raw |> String.trim() |> String.upcase()
        cs = put_change(changeset, :country_of_origin, normalised)

        if Regex.match?(~r/\A[A-Z]{2}\z/, normalised) do
          cs
        else
          add_error(cs, :country_of_origin, "must be a two-letter ISO 3166-1 code (e.g. GB, US)")
        end
    end
  end

  defp validate_decimal_in_range(changeset, field, min, max) do
    case get_field(changeset, field) do
      %Decimal{} = d ->
        if Decimal.compare(d, min) != :lt and Decimal.compare(d, max) != :gt do
          changeset
        else
          add_error(changeset, field, "must be between #{min} and #{max}")
        end

      _ ->
        changeset
    end
  end

  defp validate_number_if_set(changeset, field, opts) do
    case get_field(changeset, field) do
      nil -> changeset
      _ -> validate_number(changeset, field, opts)
    end
  end

  # `review_due_at = last_reviewed_at + review_frequency_months`.
  # Recomputed on every write so the queue stays current.
  defp compute_review_due_at(changeset) do
    last = get_field(changeset, :last_reviewed_at)
    freq = get_field(changeset, :review_frequency_months)

    cond do
      is_nil(last) or is_nil(freq) ->
        put_change(changeset, :review_due_at, nil)

      true ->
        due =
          last
          |> DateTime.to_date()
          |> add_months(freq)

        put_change(changeset, :review_due_at, due)
    end
  end

  defp add_months(%Date{year: y, month: m, day: d}, months) when is_integer(months) do
    total = (y * 12 + (m - 1)) + months
    new_year = div(total, 12)
    new_month = rem(total, 12) + 1
    {:ok, base} = Date.new(new_year, new_month, 1)
    # Clamp day if e.g. Jan 31 + 1 month → end of Feb.
    last_day = Date.days_in_month(base)
    {:ok, result} = Date.new(new_year, new_month, min(d, last_day))
    result
  end
end
