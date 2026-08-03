defmodule Backend.Repo.Migrations.SwapRdConsumptionCellFkForTag do
  use Ecto.Migration

  @moduledoc """
  Second thought on the R&D pickup destination.

  Migration 20260803120000 added ``companies.rd_consumption_cell_id``
  as a single FK — one drop-off cell per company. That's too rigid:
  companies with multiple R&D benches (per warehouse, per floor)
  needed separate configuration paths, and the settings UI had to
  ship a whole picker for a single value.

  This migration replaces that single FK with the existing tag
  registry pattern:

    * Drops the ``rd_consumption_cell_id`` column + its index.
    * Seeds a reserved ``rnd_consumption`` tag (kind: ``cell``) into
      every company's registry. Operators tag any storage cell with
      it in Warehouse settings, and the pickup-target validator on
      trial / sample MOs accepts any cell whose effective tags
      contain ``rnd_consumption`` — mirrors the ``rnd`` stock-stream
      isolation semantics landed in the same PR chain.

  Data loss note: any FK values previously stored in
  ``rd_consumption_cell_id`` are dropped. This is intentional — the
  user explicitly asked for a full removal, and the tag-based flow
  supersedes the FK entirely.
  """

  def change do
    execute(
      # Drop the FK column + its supporting index. Ecto's ``alter
      # table`` handles the FK constraint drop automatically since the
      # column reference vanishes.
      "ALTER TABLE companies DROP COLUMN IF EXISTS rd_consumption_cell_id",
      # Down: restore the FK column shape from migration 20260803120000
      # so a rollback ends up in the same state that migration left us.
      "ALTER TABLE companies ADD COLUMN rd_consumption_cell_id BIGINT REFERENCES storage_cells(id) ON DELETE SET NULL"
    )

    # Seed the reserved ``rnd_consumption`` tag into every company's
    # registry. ON CONFLICT DO NOTHING so re-running the migration is
    # safe. ``kind = cell`` — this is strictly a cell tag; an item
    # wouldn't be tagged ``rnd_consumption`` (items get ``rnd`` to
    # indicate ownership of the R&D stock stream).
    execute(
      """
      INSERT INTO storage_tags (uuid, company_id, key, label, description, kind, inserted_at, updated_at)
      SELECT
        gen_random_uuid(),
        c.id,
        'rnd_consumption',
        'R&D consumption',
        'Reserved for cells that receive R&D / trial-batch pickup output. When a trial or sample MO releases to the warehouse, the picker may deposit into any cell tagged rnd_consumption.',
        'cell',
        NOW(),
        NOW()
      FROM companies c
      ON CONFLICT (company_id, key) DO NOTHING
      """,
      # Down: strip the seeded rows. The label + description are our
      # own, so a delete by key on rows we own is safe.
      "DELETE FROM storage_tags WHERE key = 'rnd_consumption'"
    )
  end
end
