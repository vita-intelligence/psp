defmodule Backend.Items.PackagingCompliance do
  @moduledoc """
  Packaging compliance — 1:1 with `items` (where `item_type =
  "packaging"`). Carries material + food-contact compliance + the
  migration test cert.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Items.Item

  @primary_key {:item_id, :id, autogenerate: false}
  @foreign_key_type :id

  @materials ~w(glass hdpe pet pp cardboard aluminum multi_layer other)

  schema "item_packaging_compliance" do
    field :material, :string
    field :food_contact_compliant, :boolean
    field :food_contact_declaration_url, :string
    field :recyclability_code, :string
    field :migration_test_url, :string
    field :migration_test_expires_at, :date

    belongs_to :item, Item, primary_key: true, define_field: false

    timestamps(type: :utc_datetime)
  end

  def materials, do: @materials

  def changeset(struct, attrs) do
    struct
    |> cast(attrs, [
      :item_id,
      :material,
      :food_contact_compliant,
      :food_contact_declaration_url,
      :recyclability_code,
      :migration_test_url,
      :migration_test_expires_at
    ])
    |> validate_required([:item_id])
    |> validate_inclusion_if_set(:material, @materials)
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
end
