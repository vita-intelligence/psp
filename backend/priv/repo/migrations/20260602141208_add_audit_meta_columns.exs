defmodule Backend.Repo.Migrations.AddAuditMetaColumns do
  use Ecto.Migration

  @moduledoc """
  Phase A of the audit feature: stamp every audited entity with who
  created it and who last updated it.

  `inserted_at` + `updated_at` already exist via the `timestamps/0`
  macro; this migration adds the matching "by-whom" columns:

    * `created_by_id` — FK to `users.id`, nullable. Set by the
      context-layer create fn. Nullable because seed rows + the
      bootstrap user have no attributable creator.
    * `updated_by_id` — FK to `users.id`, nullable. Set by the
      context-layer update fn. Nullable for the same reason and
      because freshly-created rows haven't been updated yet.

  Both FKs use `ON DELETE SET NULL` so deactivating a user doesn't
  cascade-blow up everything they ever touched — we'd rather show
  "Unknown user" on a stale history row than lose the row.
  """

  def up do
    for tbl <- ~w(warehouses users roles) do
      execute("""
      ALTER TABLE #{tbl}
        ADD COLUMN IF NOT EXISTS created_by_id bigint
          REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS updated_by_id bigint
          REFERENCES users(id) ON DELETE SET NULL
      """)

      execute(
        "CREATE INDEX IF NOT EXISTS #{tbl}_created_by_id_index ON #{tbl} (created_by_id)"
      )

      execute(
        "CREATE INDEX IF NOT EXISTS #{tbl}_updated_by_id_index ON #{tbl} (updated_by_id)"
      )
    end
  end

  def down do
    for tbl <- ~w(warehouses users roles) do
      execute("DROP INDEX IF EXISTS #{tbl}_updated_by_id_index")
      execute("DROP INDEX IF EXISTS #{tbl}_created_by_id_index")

      alter table(tbl) do
        remove_if_exists(:created_by_id, :bigint)
        remove_if_exists(:updated_by_id, :bigint)
      end
    end
  end
end
