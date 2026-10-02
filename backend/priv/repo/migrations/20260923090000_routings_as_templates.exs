defmodule Backend.Repo.Migrations.RoutingsAsTemplates do
  @moduledoc """
  Routings become reusable templates. Previously every routing was
  pinned to one item (`item_id` NOT NULL). Now a routing with
  `item_id IS NULL` is a **template** — an admin-authored, item-less
  recipe that NPD's formulation builder picks from. Routings with
  `item_id` set are **snapshots** — frozen copies stamped onto a
  specific item at sync time; the per-item routing surface MO
  creation reads from.

  Snapshots carry a `source_template_id` FK back to the template they
  were minted from, and each `routing_steps` row carries a
  `source_routing_step_id` FK back to the template step. Both are
  `SET NULL` on delete — deleting a template leaves historical
  snapshots intact but orphans the provenance pointer.

  Name uniqueness splits:
    * templates: `UNIQUE (company_id, name) WHERE item_id IS NULL`
      — the dropdown stays sane.
    * snapshots: `UNIQUE (company_id, item_id) WHERE item_id IS NOT NULL`
      — enforces the existing invariant that an item has at most one
      snapshot (what `maybe_resolve_routing/1` already assumed).

  No data migration needed: every existing routing is treated as a
  snapshot (keeps its `item_id`), so the new indexes apply without
  renames.
  """

  use Ecto.Migration

  def change do
    execute(
      "ALTER TABLE routings ALTER COLUMN item_id DROP NOT NULL",
      "ALTER TABLE routings ALTER COLUMN item_id SET NOT NULL"
    )

    alter table(:routings) do
      add :source_template_id,
          references(:routings, on_delete: :nilify_all)
    end

    alter table(:routing_steps) do
      add :source_routing_step_id,
          references(:routing_steps, on_delete: :nilify_all)
    end

    create index(:routings, [:source_template_id])
    create index(:routing_steps, [:source_routing_step_id])

    execute(
      "DROP INDEX IF EXISTS routings_company_name_index",
      "CREATE UNIQUE INDEX routings_company_name_index ON routings (company_id, name)"
    )

    create unique_index(:routings, [:company_id, :name],
             where: "item_id IS NULL",
             name: :routings_template_name_index
           )

    create unique_index(:routings, [:company_id, :item_id],
             where: "item_id IS NOT NULL",
             name: :routings_item_snapshot_index
           )

    # A snapshot must point at a template (nullable only for pre-flow
    # legacy rows). A template must NOT point at another template.
    execute(
      """
      ALTER TABLE routings
      ADD CONSTRAINT routings_template_shape
      CHECK (
        (item_id IS NULL AND source_template_id IS NULL) OR
        item_id IS NOT NULL
      )
      """,
      "ALTER TABLE routings DROP CONSTRAINT routings_template_shape"
    )
  end
end
