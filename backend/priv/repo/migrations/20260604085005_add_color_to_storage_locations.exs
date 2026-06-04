defmodule Backend.Repo.Migrations.AddColorToStorageLocations do
  use Ecto.Migration

  def change do
    alter table(:storage_locations) do
      # Optional fill colour override. Format is a `#RRGGBB` hex
      # string; `nil` means "use the kind's default palette". 9 chars
      # is enough room if we ever extend to `#RRGGBBAA` without
      # another migration.
      add :color, :string, size: 9
    end
  end
end
