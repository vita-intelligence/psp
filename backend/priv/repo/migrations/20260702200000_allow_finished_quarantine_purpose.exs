defmodule Backend.Repo.Migrations.AllowFinishedQuarantinePurpose do
  use Ecto.Migration

  # The Final Product Release plumbing added `finished_quarantine` to
  # `Backend.Warehouses.StorageCell.@purposes` but missed the matching
  # DB CHECK constraint. Without this, saving a cell with
  # purpose = 'finished_quarantine' from the FE plan editor 500s with
  # a check_violation on `storage_cells_purpose_check`.
  #
  # Same drop-and-recreate pattern the earlier
  # 20260622100000_allow_production_feed_purpose migration used.
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
                           'dispatch','production_feed','finished_quarantine'))
      """,
      """
      ALTER TABLE storage_cells
        ADD CONSTRAINT storage_cells_purpose_check
        CHECK (purpose IN ('regular','quarantine','hold','rejected',
                           'dispatch','production_feed'))
      """
    )
  end
end
