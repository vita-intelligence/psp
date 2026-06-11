defmodule Backend.Items.FinishedProductSpec do
  @moduledoc """
  Finished-product specification. 1:1 with `items` (where
  `item_type = "finished_product"`).
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Items.{Item, ItemFile}
  alias Backend.Units.UnitOfMeasurement

  @primary_key {:item_id, :id, autogenerate: false}
  @foreign_key_type :id

  @regulatory_categories ~w(food_supplement functional_food cosmetic medical_device)
  @dosage_forms ~w(capsule tablet softgel powder liquid gummy)
  @capsule_sizes ~w(000 00 0 1 2 3 4)
  @powder_types ~w(standard protein)

  schema "item_finished_product_spec" do
    field :regulatory_category, :string
    field :dosage_form, :string
    field :capsule_size, :string
    field :tablet_size_mm, :decimal
    field :powder_type, :string
    field :serving_size, :decimal
    field :servings_per_pack, :integer
    field :net_quantity, :decimal
    field :directions_of_use, :string
    field :suggested_dosage, :string
    field :warnings_text, :string
    field :appearance, :string
    field :disintegration_spec, :string
    field :weight_uniformity_pct, :decimal
    field :shelf_life_months, :integer
    field :storage_conditions, :string
    field :food_contact_status, :string
    field :active_claims, {:array, :map}, default: []
    field :general_claims, {:array, :map}, default: []
    field :nutrition_table, :map, default: %{}
    field :target_markets, {:array, :string}, default: []
    field :may_contain_allergens, {:array, :string}, default: []
    field :may_contain_justification, :string
    field :may_contain_assessed_at, :utc_datetime
    field :contaminant_limits_overrides, :map, default: %{}

    belongs_to :item, Item, primary_key: true, define_field: false
    belongs_to :serving_size_uom, UnitOfMeasurement
    belongs_to :net_quantity_uom, UnitOfMeasurement
    belongs_to :may_contain_assessed_by, User
    belongs_to :spec_document_file, ItemFile

    timestamps(type: :utc_datetime)
  end

  def regulatory_categories, do: @regulatory_categories
  def dosage_forms, do: @dosage_forms
  def capsule_sizes, do: @capsule_sizes
  def powder_types, do: @powder_types

  def changeset(struct, attrs) do
    struct
    |> cast(attrs, [
      :item_id,
      :regulatory_category,
      :dosage_form,
      :capsule_size,
      :tablet_size_mm,
      :powder_type,
      :serving_size,
      :serving_size_uom_id,
      :servings_per_pack,
      :net_quantity,
      :net_quantity_uom_id,
      :directions_of_use,
      :suggested_dosage,
      :warnings_text,
      :appearance,
      :disintegration_spec,
      :weight_uniformity_pct,
      :shelf_life_months,
      :storage_conditions,
      :food_contact_status,
      :active_claims,
      :general_claims,
      :nutrition_table,
      :target_markets,
      :spec_document_file_id,
      :may_contain_allergens,
      :may_contain_justification,
      :may_contain_assessed_at,
      :may_contain_assessed_by_id,
      :contaminant_limits_overrides
    ])
    |> validate_required([:item_id])
    |> validate_inclusion_if_set(:regulatory_category, @regulatory_categories)
    |> validate_inclusion_if_set(:dosage_form, @dosage_forms)
    |> validate_inclusion_if_set(:capsule_size, @capsule_sizes)
    |> validate_inclusion_if_set(:powder_type, @powder_types)
    |> validate_target_markets()
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

  # Target markets: list of two-letter ISO codes.
  defp validate_target_markets(changeset) do
    case get_field(changeset, :target_markets) do
      list when is_list(list) ->
        bad = Enum.reject(list, &Regex.match?(~r/\A[A-Z]{2}\z/, &1))

        if bad == [] do
          changeset
        else
          add_error(
            changeset,
            :target_markets,
            "invalid country code(s): #{Enum.join(bad, ", ")}"
          )
        end

      _ ->
        changeset
    end
  end
end
