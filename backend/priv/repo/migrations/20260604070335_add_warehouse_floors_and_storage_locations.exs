defmodule Backend.Repo.Migrations.AddWarehouseFloorsAndStorageLocations do
  use Ecto.Migration

  @moduledoc """
  Phase 1 of the warehouse plan editor.

  Two new tables:

    * `warehouse_floors` — one row per floor. Carries the floor's
      canvas state (walls + rooms drawn on the plan) as a JSONB blob
      under `canvas_json`. Floors are ordered within a warehouse via
      `ordinal` so the floor switcher can render them stably.

    * `storage_locations` — first-class entities (NOT shapes inside
      the canvas JSON). Each location has its own UUID, dimensions,
      kind, capacity, and a position on the parent floor. Stock
      records and transfer logs will FK into this in the future, so
      we treat them as proper rows from day one.

  Both tables get the audit-meta columns (`created_by_id`,
  `updated_by_id`) and unique UUID indexes the same way every other
  entity in PSP does.

  Cascade behaviour:
    * Delete a warehouse → its floors + locations cascade away.
    * Delete a floor → its locations cascade away.
  """

  def change do
    execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    create table(:warehouse_floors) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")
      add :warehouse_id, references(:warehouses, on_delete: :delete_all), null: false
      add :name, :string, null: false, size: 80
      # Position in the floor switcher. Lower ordinal = lower floor
      # (ground floor first). Re-numbered on drag-reorder.
      add :ordinal, :integer, null: false, default: 0
      # Walls, rooms, and viewport state. Storage locations live in
      # their own table — the canvas JSON only carries the
      # architectural shapes.
      add :canvas_json, :map, null: false, default: %{}

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:warehouse_floors, [:uuid])
    create index(:warehouse_floors, [:warehouse_id, :ordinal])
    create unique_index(:warehouse_floors, [:warehouse_id, :name])

    create table(:storage_locations) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")
      # Warehouse FK is denormalised even though floor_id implies it
      # — it makes "list all locations for warehouse X" a single
      # index lookup without joining floors. Saves a hop on hot reads.
      add :warehouse_id, references(:warehouses, on_delete: :delete_all), null: false
      add :floor_id, references(:warehouse_floors, on_delete: :delete_all), null: false

      add :name, :string, null: false, size: 120
      # Short identifier shown on the canvas tile and used in stock
      # records ("A-12", "RACK-03"). Unique per warehouse.
      add :code, :string, size: 40
      # Optional category — "rack", "shelf", "pallet_zone", "cold_storage",
      # etc. Kept as a string so adding a new kind doesn't need a
      # migration; UI restricts the picker to a known list.
      add :kind, :string, size: 40

      # Position on the floor canvas, in canvas units (1 unit = 1cm
      # at design time, scaled by zoom). Physical dimensions in
      # metres live separately so the canvas can render to scale.
      add :x, :integer, null: false, default: 0
      add :y, :integer, null: false, default: 0
      add :width, :integer, null: false, default: 100
      add :height, :integer, null: false, default: 100

      # Physical dimensions (in metres). Decoupled from canvas
      # dimensions because the canvas is a schematic, not a CAD
      # drawing — operators tune visual sizing for legibility while
      # the physical numbers stay accurate for capacity calc.
      add :width_m, :decimal, precision: 6, scale: 2
      add :height_m, :decimal, precision: 6, scale: 2
      add :depth_m, :decimal, precision: 6, scale: 2

      # Free-text capacity hint ("12 pallets", "300kg"). Kept as a
      # string until we ship the stock module — at which point this
      # becomes a numeric column with a unit enum.
      add :capacity, :string, size: 60

      add :notes, :text

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:storage_locations, [:uuid])
    create index(:storage_locations, [:warehouse_id])
    create index(:storage_locations, [:floor_id])
    # Code is unique per warehouse (NULLs allowed because code is
    # optional for early-stage locations that haven't been assigned
    # yet).
    create unique_index(:storage_locations, [:warehouse_id, :code],
             where: "code IS NOT NULL",
             name: :storage_locations_warehouse_id_code_index
           )
  end
end
