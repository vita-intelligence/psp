defmodule Backend.Repo.Migrations.BackfillRawMaterialComplianceFromAttributes do
  use Ecto.Migration

  # Backfill: for every raw-material item that carries
  # ``attributes.use_as`` on its JSONB bag (Title Case, populated by
  # the NPD integration wire) but has no ``item_raw_material_compliance``
  # side-table row, create the side-table row with ``use_as`` set to
  # the snake_case equivalent.
  #
  # Why this matters:
  #
  # ``attributes.use_as`` is what NPD's picker filters on when it
  # asks for e.g. anti-caking or carrier candidates. The PSP item
  # form binds instead to ``item_raw_material_compliance.use_as``,
  # so an item populated via the integration wire alone (no operator
  # ever opened the item form to fill it in) was addressable by NPD
  # but showed every compliance field as "Not set" on PSP — and the
  # "Ready to promote" banner short-circuited to "all checks pass"
  # because the missing subtable made the blocker check return nil.
  #
  # This migration doesn't fabricate compliance data. It only mirrors
  # the ONE column that already existed in two shapes, so the
  # side-table row exists and the operator can finish filling the
  # rest (allergen_status, vegan_status, GMO, country of origin,
  # shelf-life, storage conditions). Once the row exists, the
  # blocker check runs honestly and the banner shows the real
  # missing-field list.
  #
  # Idempotent: an ``ON CONFLICT DO NOTHING`` on the primary key
  # (item_id) means re-running the migration doesn't touch rows
  # that already exist.
  #
  # Vocabulary safety: the snake_case list must be a subset of
  # RawMaterialCompliance's ``@use_as_choices``; the CASE below is
  # hand-transcribed from ``RawMaterialCompliance.snake_use_as/1``
  # (verified 2026-07-16). Any ``attributes.use_as`` value that
  # doesn't map to a known snake key is left alone — no row is
  # created and no data is invented. The next PSP form open will
  # still show the value via the read-side attributes fallback.

  def up do
    # NOTE: SQL casts every UNKNOWN Title-Case value to NULL and the
    # ``WHERE`` clause on the outer INSERT filters those rows out.
    # Only items whose ``attributes.use_as`` maps to a snake key are
    # inserted; everything else is a no-op.
    execute """
    INSERT INTO item_raw_material_compliance (
      item_id, use_as, inserted_at, updated_at
    )
    SELECT
      i.id,
      CASE LOWER(TRIM(i.attributes->>'use_as'))
        WHEN 'active' THEN 'active'
        WHEN 'sweeteners' THEN 'sweetener'
        WHEN 'sweetener' THEN 'sweetener'
        WHEN 'sweetners' THEN 'sweetener'
        WHEN 'bulking agent' THEN 'bulking_agent'
        WHEN 'bulking_agent' THEN 'bulking_agent'
        WHEN 'flavouring' THEN 'flavouring'
        WHEN 'colour' THEN 'colour'
        WHEN 'colourant' THEN 'colour'
        WHEN 'acidity regulator' THEN 'acidity_regulator'
        WHEN 'acidity_regulator' THEN 'acidity_regulator'
        WHEN 'glazing agent' THEN 'glazing_agent'
        WHEN 'glazing_agent' THEN 'glazing_agent'
        WHEN 'gelling agent' THEN 'gelling_agent'
        WHEN 'gelling_agent' THEN 'gelling_agent'
        WHEN 'emulsifier' THEN 'emulsifier'
        WHEN 'disintegrant' THEN 'disintegrant'
        WHEN 'stabiliser' THEN 'stabiliser'
        WHEN 'anti-caking agent' THEN 'anti_caking'
        WHEN 'anti-caking' THEN 'anti_caking'
        WHEN 'anti_caking' THEN 'anti_caking'
        WHEN 'coating agent' THEN 'coating'
        WHEN 'coating' THEN 'coating'
        WHEN 'preservative' THEN 'preservative'
        WHEN 'carrier' THEN 'carrier'
        WHEN 'excipient' THEN 'excipient'
        WHEN 'capsule shell' THEN 'capsule_shell'
        WHEN 'capsule_shell' THEN 'capsule_shell'
        WHEN 'other' THEN 'other'
        WHEN 'others' THEN 'other'
        ELSE NULL
      END AS use_as,
      NOW() AT TIME ZONE 'UTC' AS inserted_at,
      NOW() AT TIME ZONE 'UTC' AS updated_at
    FROM items i
    LEFT JOIN item_raw_material_compliance rmc ON rmc.item_id = i.id
    WHERE
      i.item_type = 'raw_material'
      AND rmc.item_id IS NULL
      AND i.attributes ? 'use_as'
      AND i.attributes->>'use_as' IS NOT NULL
      AND i.attributes->>'use_as' != ''
      AND CASE LOWER(TRIM(i.attributes->>'use_as'))
        WHEN 'active' THEN 'active'
        WHEN 'sweeteners' THEN 'sweetener'
        WHEN 'sweetener' THEN 'sweetener'
        WHEN 'sweetners' THEN 'sweetener'
        WHEN 'bulking agent' THEN 'bulking_agent'
        WHEN 'bulking_agent' THEN 'bulking_agent'
        WHEN 'flavouring' THEN 'flavouring'
        WHEN 'colour' THEN 'colour'
        WHEN 'colourant' THEN 'colour'
        WHEN 'acidity regulator' THEN 'acidity_regulator'
        WHEN 'acidity_regulator' THEN 'acidity_regulator'
        WHEN 'glazing agent' THEN 'glazing_agent'
        WHEN 'glazing_agent' THEN 'glazing_agent'
        WHEN 'gelling agent' THEN 'gelling_agent'
        WHEN 'gelling_agent' THEN 'gelling_agent'
        WHEN 'emulsifier' THEN 'emulsifier'
        WHEN 'disintegrant' THEN 'disintegrant'
        WHEN 'stabiliser' THEN 'stabiliser'
        WHEN 'anti-caking agent' THEN 'anti_caking'
        WHEN 'anti-caking' THEN 'anti_caking'
        WHEN 'anti_caking' THEN 'anti_caking'
        WHEN 'coating agent' THEN 'coating'
        WHEN 'coating' THEN 'coating'
        WHEN 'preservative' THEN 'preservative'
        WHEN 'carrier' THEN 'carrier'
        WHEN 'excipient' THEN 'excipient'
        WHEN 'capsule shell' THEN 'capsule_shell'
        WHEN 'capsule_shell' THEN 'capsule_shell'
        WHEN 'other' THEN 'other'
        WHEN 'others' THEN 'other'
        ELSE NULL
      END IS NOT NULL
    ON CONFLICT (item_id) DO NOTHING;
    """
  end

  def down do
    # No-op: the backfill is data-only + additive. Rolling back the
    # migration doesn't delete the rows — an operator may have
    # touched them in the item form after the backfill ran, and
    # blowing them away would lose that legitimate work. The
    # migration is safe to run again if needed (idempotent), so
    # there's no reason to undo it.
    :ok
  end
end
