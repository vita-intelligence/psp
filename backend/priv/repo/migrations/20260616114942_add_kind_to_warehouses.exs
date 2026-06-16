defmodule Backend.Repo.Migrations.AddKindToWarehouses do
  use Ecto.Migration

  @moduledoc """
  Warehouses get a `kind` discriminator so the same table powers two
  visibly-distinct surfaces in the UI:

    * `warehouse` (default, existing rows) — `/settings/warehouses`,
      gated by `warehouses.*` permissions.
    * `production_facility` — `/settings/production-sites`, gated by
      the new `production.facility_*` family. Production sites hold
      WIP stock during manufacturing and (in a follow-up) host
      workstations on their floor plan.

  Everything below the warehouse (floors, storage_locations,
  storage_cells, plan jsonb) stays identical between the two — a cell
  is a cell, a placement is a placement. The discriminator is purely a
  classification of the parent.
  """

  def change do
    alter table(:warehouses) do
      add :kind, :string, size: 32, null: false, default: "warehouse"
    end

    create constraint(:warehouses, :warehouses_kind_known,
             check: "kind in ('warehouse', 'production_facility')"
           )

    # Most lookups still filter `company_id` first; the partial index
    # speeds up the kind-scoped list queries that the new controller
    # runs on every page load without doubling write cost on the
    # majority-warehouse rows.
    create index(:warehouses, [:company_id, :kind])
  end
end
