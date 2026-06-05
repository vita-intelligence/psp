defmodule Backend.Allergens.Allergen do
  @moduledoc """
  Global EU 1169/2011 Annex II declared allergens. Read-only from the
  app — the rows are seeded by migration and never mutated by users.
  Items reference these via the `item_allergens` M:N (added in Slice 2).
  """

  use Ecto.Schema

  schema "allergens" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :key, :string
    field :label, :string
    field :source, :string, default: "eu_1169_2011_annex_ii"
    field :sort_order, :integer, default: 0
    timestamps(type: :utc_datetime)
  end
end
