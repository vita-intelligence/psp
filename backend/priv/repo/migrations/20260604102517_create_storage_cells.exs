defmodule Backend.Repo.Migrations.CreateStorageCells do
  use Ecto.Migration

  def change do
    create table(:storage_cells) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :storage_location_id,
          references(:storage_locations, on_delete: :delete_all),
          null: false

      # Denormalised — same reason floors + storage_locations carry it.
      # Audit + cross-company isolation stays a single-index lookup.
      add :company_id, references(:companies), null: false

      # 0 = bottom-most level. Two cells in the same location can't
      # share a level; the unique index below enforces that.
      add :ordinal, :integer, null: false, default: 0

      # Optional operator label per level. Falls back to "Level <ordinal+1>"
      # in the UI when nil.
      add :name, :string, size: 80

      # Physical dimensions of the cell in metres. The location keeps
      # its overall footprint on the canvas; cells stack vertically and
      # may have smaller width / depth than the location (e.g. a half-
      # depth top shelf).
      add :width_m, :decimal, precision: 8, scale: 3
      add :depth_m, :decimal, precision: 8, scale: 3
      add :height_m, :decimal, precision: 8, scale: 3

      # Optional weight cap. Most cells leave it null; pallet positions
      # and high shelves are the typical reason to set it.
      add :max_weight_kg, :decimal, precision: 10, scale: 2

      # Free-form classification labels: "cold", "hazmat-3", "allergen-
      # nuts", "raw-oil", "quarantine"… No fixed vocabulary so the
      # segregation rules engine (later) can plug in without a schema
      # change.
      add :tags, {:array, :string}, null: false, default: []

      add :notes, :text

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:storage_cells, [:storage_location_id, :ordinal])
    create unique_index(:storage_cells, [:uuid])
    create index(:storage_cells, [:company_id])
    create index(:storage_cells, [:storage_location_id])
    # GIN index makes tag-membership filters cheap (e.g. "all cells
    # tagged `cold` and inside warehouse N").
    create index(:storage_cells, [:tags], using: "gin")
  end
end
