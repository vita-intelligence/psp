defmodule Backend.Repo.Migrations.AddStorageCellPurposeIndex do
  use Ecto.Migration

  # Auto-router hot query — every lifecycle status change (receive,
  # QC pass/fail, hold, output QC pass) hits:
  #
  #     SELECT * FROM storage_cells c
  #     JOIN storage_locations l ON l.id = c.storage_location_id
  #     JOIN floors f ON f.id = l.floor_id
  #     WHERE f.warehouse_id = $1
  #       AND c.purpose = $2
  #       AND c.system_kind IS NULL
  #       AND l.system_kind IS NULL
  #       AND f.system_kind IS NULL
  #     ORDER BY c.id
  #     LIMIT 1
  #
  # Without an index on ``(company_id, purpose)`` (or the joined
  # equivalent) Postgres does a sequential scan of ``storage_cells``
  # for every route decision. At 5k+ cells and dozens of concurrent
  # goods-in receives, this stacks up as measurable latency in the
  # mobile receive flow.
  #
  # A partial composite on ``(company_id, purpose) WHERE
  # system_kind IS NULL`` is the exact filter shape the router uses;
  # keeps the index small (system cells excluded) and answers the
  # candidate lookup with an index-only scan.
  @disable_ddl_transaction true
  @disable_migration_lock true

  def change do
    create_if_not_exists index(
                           :storage_cells,
                           [:company_id, :purpose],
                           where: "system_kind IS NULL",
                           name: :storage_cells_operator_by_purpose_idx,
                           concurrently: true
                         )
  end
end
