defmodule Backend.Repo.Migrations.AddStorageTagsToItems do
  use Ecto.Migration

  @moduledoc """
  Items declare which storage tags they need (e.g. `ambient`,
  `raw-material`). The receive form filters destination cells to
  ones whose effective tags (location.tags ∪ cell.tags) are a
  superset of the item's storage_tags — so a powder tagged
  `ambient` only goes into ambient cells.

  Tags share the company-scoped storage_tags registry; no separate
  vocabulary.
  """

  def change do
    alter table(:items) do
      add :storage_tags, {:array, :string}, null: false, default: fragment("ARRAY[]::varchar[]")
    end

    # GIN index lets us later answer "which items need this tag?"
    # without a sequential scan when allocation joins are added.
    create index(:items, [:storage_tags], using: "GIN")
  end
end
