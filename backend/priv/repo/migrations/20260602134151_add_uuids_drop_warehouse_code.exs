defmodule Backend.Repo.Migrations.AddUuidsDropWarehouseCode do
  use Ecto.Migration

  @moduledoc """
  Public-identifier overhaul.

    * Add a `uuid` column (auto-backfilled with `gen_random_uuid()`,
      `NOT NULL`, unique-indexed) to **warehouses**, **users**, and
      **roles** (the permission-template table). The integer primary
      key stays — UUIDs are the public-facing identifier (URLs, API
      paths, channel topics) while integer PKs keep foreign keys
      compact and indexes dense.
    * Drop `warehouses.code` entirely — the field claimed to be used
      in URLs and printed labels, but neither URLs nor any label
      surface read it. Vestigial column, removed per the
      "no vestigial fields" rule.

  Forward-only on the uuid backfill: a rollback can drop the columns
  but we wouldn't repopulate the dropped `code` values.
  """

  def up do
    execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    for tbl <- ~w(warehouses users roles) do
      execute("ALTER TABLE #{tbl} ADD COLUMN IF NOT EXISTS uuid uuid")
      execute("UPDATE #{tbl} SET uuid = gen_random_uuid() WHERE uuid IS NULL")
      execute("ALTER TABLE #{tbl} ALTER COLUMN uuid SET NOT NULL")
      execute(
        "ALTER TABLE #{tbl} ALTER COLUMN uuid SET DEFAULT gen_random_uuid()"
      )
      execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS #{tbl}_uuid_index ON #{tbl} (uuid)"
      )
    end

    alter table(:warehouses) do
      remove_if_exists(:code, :string)
    end
  end

  def down do
    for tbl <- ~w(warehouses users roles) do
      execute("DROP INDEX IF EXISTS #{tbl}_uuid_index")
      alter table(tbl) do
        remove_if_exists(:uuid, :uuid)
      end
    end
  end
end
