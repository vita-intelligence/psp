defmodule Backend.Repo.Migrations.PromoteRndTagToPurpose do
  @moduledoc """
  Collapses the R&D "system-stream tag" concept into a first-class
  ``storage_cells.purpose`` value. The two ways of expressing R&D-ness
  were confusing (one dropdown for purpose, a separate tag block for
  the R&D flag) — one axis for both is simpler.

  Steps:

  1. Widen the ``storage_cells_purpose_check`` CHECK constraint to
     accept ``rnd``. Follows the drop-and-recreate pattern the
     earlier ``allow_three_pl_storage_purpose`` migration used
     (Postgres doesn't extend CHECK constraints in place).
  2. Promote every cell whose tags contain ``rnd`` AND whose current
     purpose is ``regular`` to ``purpose = 'rnd'``. Cells with a more
     specific purpose (quarantine / hold / rejected / dispatch /
     production_feed / finished_quarantine / three_pl_storage) are
     left alone — R&D-ness for those has to be re-modeled by hand
     since the new schema can't express "R&D quarantine cell".
  3. Same treatment for cells inside a storage_location tagged
     ``rnd`` (again, only when ``purpose = 'regular'``). Matches the
     pre-migration effective-tag semantics where a cell inherits
     R&D-ness from its parent rack.
  4. Strip ``rnd`` from every ``storage_cells.tags`` +
     ``storage_locations.tags`` array so the concept lives in one
     place only.
  5. Delete any leftover ``storage_tags`` row keyed ``rnd`` (was
     seeded to satisfy the FE picker; nothing left for it to
     represent).
  """

  use Ecto.Migration

  def up do
    # 1. Widen the CHECK first so the promotion queries below can run.
    execute("""
    ALTER TABLE storage_cells DROP CONSTRAINT IF EXISTS storage_cells_purpose_check
    """)

    execute("""
    ALTER TABLE storage_cells
      ADD CONSTRAINT storage_cells_purpose_check
      CHECK (purpose IN ('regular','quarantine','hold','rejected',
                         'dispatch','production_feed','finished_quarantine',
                         'three_pl_storage','rnd'))
    """)

    # 2. Promote cells directly tagged rnd
    execute("""
    UPDATE storage_cells
    SET purpose = 'rnd'
    WHERE 'rnd' = ANY(tags)
      AND purpose = 'regular';
    """)

    # 3. Promote cells inheriting rnd from their rack (only when the
    # cell itself doesn't already carry the tag — those got caught by
    # step 2 — and only when the cell has a regular purpose).
    execute("""
    UPDATE storage_cells c
    SET purpose = 'rnd'
    FROM storage_locations l
    WHERE c.storage_location_id = l.id
      AND 'rnd' = ANY(l.tags)
      AND NOT ('rnd' = ANY(c.tags))
      AND c.purpose = 'regular';
    """)

    # 4. Strip "rnd" from every cell + rack tag array
    execute("""
    UPDATE storage_cells
    SET tags = array_remove(tags, 'rnd')
    WHERE 'rnd' = ANY(tags);
    """)

    execute("""
    UPDATE storage_locations
    SET tags = array_remove(tags, 'rnd')
    WHERE 'rnd' = ANY(tags);
    """)

    # 5. Delete the seeded "rnd" tag rows — they were only there to
    # populate the tag picker's system-stream section, which no longer
    # renders.
    execute("DELETE FROM storage_tags WHERE key = 'rnd';")
  end

  def down do
    # Best-effort rollback: convert purpose='rnd' cells back to
    # purpose='regular' + re-tag them. We can't perfectly restore the
    # rack-level tag inheritance because we don't know which cells
    # inherited vs held the tag directly — every cell gets tagged
    # explicitly on rollback. Reseeding the "rnd" storage_tags row is
    # left to app boot / a fresh seed.
    execute("""
    UPDATE storage_cells
    SET purpose = 'regular',
        tags = array_append(coalesce(tags, ARRAY[]::varchar[]), 'rnd')
    WHERE purpose = 'rnd';
    """)

    # Restore the narrower CHECK constraint.
    execute("""
    ALTER TABLE storage_cells DROP CONSTRAINT IF EXISTS storage_cells_purpose_check
    """)

    execute("""
    ALTER TABLE storage_cells
      ADD CONSTRAINT storage_cells_purpose_check
      CHECK (purpose IN ('regular','quarantine','hold','rejected',
                         'dispatch','production_feed','finished_quarantine',
                         'three_pl_storage'))
    """)
  end
end
