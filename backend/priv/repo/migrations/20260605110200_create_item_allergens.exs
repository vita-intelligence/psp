defmodule Backend.Repo.Migrations.CreateItemAllergens do
  use Ecto.Migration

  @moduledoc """
  M:N join between items and the global EU 1169/2011 allergen lookup.
  Composite PK enforces uniqueness; cascade on item delete keeps
  cleanup simple, restrict on allergen prevents accidental seed-row
  removal.
  """

  def change do
    create table(:item_allergens, primary_key: false) do
      add :item_id, references(:items, on_delete: :delete_all),
        primary_key: true,
        null: false

      add :allergen_id, references(:allergens, on_delete: :restrict),
        primary_key: true,
        null: false

      add :inserted_at, :utc_datetime, null: false
    end

    # Fast "which items contain peanuts" lookup.
    create index(:item_allergens, [:allergen_id])
  end
end
