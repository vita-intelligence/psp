defmodule Backend.Repo.Migrations.ConsolidateRndStorageTag do
  use Ecto.Migration

  @moduledoc """
  Collapse ``rnd`` + ``rnd_consumption`` into one system-reserved
  cell tag.

  Migration 20260803120000 seeded ``rnd`` (item + cell) as the R&D
  stream marker. Migration 20260803140000 seeded ``rnd_consumption``
  (cell-only) as the R&D drop-off destination. After the lot-level
  ``is_rnd`` refactor in 20260803150000, both tags collapsed to the
  same meaning — "this cell is the R&D shelf" — so we drop
  ``rnd_consumption`` and keep ``rnd`` as the single source of truth.

  The pickup-target validator (see ``Backend.Production
  .fetch_pickup_target_cell``) now checks for ``rnd`` instead of
  ``rnd_consumption``.
  """

  def change do
    execute(
      "DELETE FROM storage_tags WHERE key = 'rnd_consumption'",
      # Down: re-seed the tag on every company so a rollback lands
      # in the same shape as the pre-consolidation state.
      """
      INSERT INTO storage_tags (uuid, company_id, key, label, description, kind, inserted_at, updated_at)
      SELECT
        gen_random_uuid(),
        c.id,
        'rnd_consumption',
        'R&D consumption',
        'Reserved for cells that receive R&D / trial-batch pickup output.',
        'cell',
        NOW(),
        NOW()
      FROM companies c
      ON CONFLICT (company_id, key) DO NOTHING
      """
    )
  end
end
