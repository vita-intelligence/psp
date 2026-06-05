defmodule Backend.Items.ItemAllergen do
  @moduledoc """
  Composite-PK join between items and the global allergen lookup.
  Maintained by the RawMaterials context's `set_allergens/3` operation
  — full-replace semantics (delete + insert in one transaction) so the
  FE just sends the desired list every save.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Allergens.Allergen
  alias Backend.Items.Item

  @primary_key false

  schema "item_allergens" do
    belongs_to :item, Item, primary_key: true
    belongs_to :allergen, Allergen, primary_key: true
    field :inserted_at, :utc_datetime
  end

  def changeset(struct, attrs) do
    struct
    |> cast(attrs, [:item_id, :allergen_id, :inserted_at])
    |> validate_required([:item_id, :allergen_id, :inserted_at])
    |> unique_constraint([:item_id, :allergen_id],
      name: :item_allergens_pkey,
      message: "this allergen is already attached to the item"
    )
  end
end
