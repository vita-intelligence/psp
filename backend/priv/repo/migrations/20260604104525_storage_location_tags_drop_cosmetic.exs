defmodule Backend.Repo.Migrations.StorageLocationTagsDropCosmetic do
  use Ecto.Migration

  def change do
    alter table(:storage_locations) do
      # Cosmetic-only — `kind` only changed the canvas colour, and
      # `capacity` was a free-text string that never drove allocation
      # math. Replaced by per-location `tags` plus the colour picker
      # we already shipped.
      remove :kind, :string
      remove :capacity, :string

      # Free-form classification labels at the location level. Cells
      # also have tags; allocation reads the UNION (location.tags ∪
      # cell.tags). Set once on the rack ("pallet", "cold-zone") and
      # every level inherits without retyping.
      add :tags, {:array, :string}, null: false, default: []
    end

    # GIN index — matches the cells.tags index so "all locations
    # tagged cold" stays cheap when allocation queries arrive.
    create index(:storage_locations, [:tags], using: "gin")
  end
end
