defmodule Backend.Repo.Migrations.AddSystemKindToWarehouseHierarchy do
  use Ecto.Migration
  import Ecto.Query

  @moduledoc """
  System-managed slots in the warehouse hierarchy — a floor / location /
  cell flagged with `system_kind` (currently only `"unregistered"`)
  that the UI hides from the plan editor + pickers but that real
  movements can target.

  Manual lot creation drops every batch into its warehouse's
  unregistered cell at first; operators later scan-move stock to a
  real shelf. That keeps "the stock exists, location is unknown"
  honestly modelled instead of forcing the receiver to lie about a
  shelf they haven't picked yet.

  Each cell needs a parent location, and each location needs a floor,
  so we provision a system floor + system location for every warehouse
  at once. The `(<table>, system_kind)` partial indexes give us
  cheap O(1) lookup of "where does this warehouse's unregistered cell
  live" without a name-match.
  """

  def change do
    alter table(:warehouse_floors) do
      add :system_kind, :string, size: 32
    end

    alter table(:storage_locations) do
      add :system_kind, :string, size: 32
    end

    alter table(:storage_cells) do
      add :system_kind, :string, size: 32
    end

    # Partial indexes — only system rows are indexed, so they cost
    # almost nothing on a normal warehouse and make the lazy-resolver
    # a single keyset hit.
    create index(:warehouse_floors, [:warehouse_id, :system_kind],
             where: "system_kind IS NOT NULL"
           )

    create index(:storage_locations, [:warehouse_id, :system_kind],
             where: "system_kind IS NOT NULL"
           )

    create index(:storage_cells, [:storage_location_id, :system_kind],
             where: "system_kind IS NOT NULL"
           )

    # Backfill: every existing warehouse gets one unregistered
    # (floor, location, cell) hierarchy. We do this inside the
    # migration so /stock/lots/new keeps working the moment the
    # backend boots — no "first request is slow" cliff.
    flush()
    backfill_unregistered_hierarchy()
  end

  defp backfill_unregistered_hierarchy do
    repo = repo()
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    warehouses =
      repo.all(from(w in "warehouses", select: {w.id, w.company_id}))

    Enum.each(warehouses, fn {warehouse_id, company_id} ->
      ensure_unregistered_hierarchy(repo, warehouse_id, company_id, now)
    end)
  end

  defp ensure_unregistered_hierarchy(repo, warehouse_id, company_id, now) do
    floor_id =
      case repo.one(
             from f in "warehouse_floors",
               where:
                 f.warehouse_id == ^warehouse_id and f.system_kind == "unregistered",
               select: f.id
           ) do
        nil ->
          {1, [%{id: id}]} =
            repo.insert_all(
              "warehouse_floors",
              [
                %{
                  uuid: Ecto.UUID.bingenerate(),
                  warehouse_id: warehouse_id,
                  company_id: company_id,
                  name: "(System)",
                  ordinal: -1,
                  canvas_json: %{},
                  system_kind: "unregistered",
                  inserted_at: now,
                  updated_at: now
                }
              ],
              returning: [:id]
            )

          id

        id ->
          id
      end

    location_id =
      case repo.one(
             from l in "storage_locations",
               where:
                 l.warehouse_id == ^warehouse_id and l.system_kind == "unregistered",
               select: l.id
           ) do
        nil ->
          {1, [%{id: id}]} =
            repo.insert_all(
              "storage_locations",
              [
                %{
                  uuid: Ecto.UUID.bingenerate(),
                  warehouse_id: warehouse_id,
                  floor_id: floor_id,
                  company_id: company_id,
                  name: "Unregistered",
                  code: nil,
                  x: 0,
                  y: 0,
                  width: 100,
                  height: 100,
                  tags: [],
                  system_kind: "unregistered",
                  inserted_at: now,
                  updated_at: now
                }
              ],
              returning: [:id]
            )

          id

        id ->
          id
      end

    case repo.one(
           from c in "storage_cells",
             where:
               c.storage_location_id == ^location_id and
                 c.system_kind == "unregistered",
             select: c.id
         ) do
      nil ->
        repo.insert_all("storage_cells", [
          %{
            uuid: Ecto.UUID.bingenerate(),
            storage_location_id: location_id,
            company_id: company_id,
            name: "Unregistered",
            ordinal: 0,
            tags: [],
            system_kind: "unregistered",
            inserted_at: now,
            updated_at: now
          }
        ])

      _ ->
        :ok
    end
  end
end
