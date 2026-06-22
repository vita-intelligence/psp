defmodule Backend.Repo.Migrations.AllowProductionFeedPurpose do
  use Ecto.Migration

  # The warehouse-pickup migration added `production_feed` to the
  # StorageCell schema's @purposes list but missed the matching DB
  # CHECK constraint. Without this, the FE plan editor + manual SQL
  # both fail with a check_violation on save.
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
        CHECK (purpose IN ('regular','quarantine','hold','rejected','dispatch','production_feed'))
      """,
      """
      ALTER TABLE storage_cells
        ADD CONSTRAINT storage_cells_purpose_check
        CHECK (purpose IN ('regular','quarantine','hold','rejected','dispatch'))
      """
    )
  end
end
