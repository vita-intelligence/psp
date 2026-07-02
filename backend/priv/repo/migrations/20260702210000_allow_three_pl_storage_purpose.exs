defmodule Backend.Repo.Migrations.AllowThreePlStoragePurpose do
  use Ecto.Migration

  # 3PL bailee custody plumbing needs a dedicated cell purpose so the
  # auto-router can drop customer-owned finished goods into
  # physically-segregated space (BRCGS Issue 9 § 4.4 segregation +
  # bailee/consignment separation from own stock). Mirrors the
  # earlier 20260702200000_allow_finished_quarantine_purpose pattern
  # — drop-and-recreate the CHECK because Postgres won't let you
  # extend one in place.
  def change do
    execute(
      """
      ALTER TABLE storage_cells DROP CONSTRAINT IF EXISTS storage_cells_purpose_check
      """,
      """
      ALTER TABLE storage_cells DROP CONSTRAINT IF EXISTS storage_cells_purpose_check
      """
    )

    execute(
      """
      ALTER TABLE storage_cells
        ADD CONSTRAINT storage_cells_purpose_check
        CHECK (purpose IN ('regular','quarantine','hold','rejected',
                           'dispatch','production_feed','finished_quarantine',
                           'three_pl_storage'))
      """,
      """
      ALTER TABLE storage_cells
        ADD CONSTRAINT storage_cells_purpose_check
        CHECK (purpose IN ('regular','quarantine','hold','rejected',
                           'dispatch','production_feed','finished_quarantine'))
      """
    )
  end
end
