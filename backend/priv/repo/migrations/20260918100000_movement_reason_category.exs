defmodule Backend.Repo.Migrations.MovementReasonCategory do
  @moduledoc """
  Adds a small enum column (`reason_category`) alongside the existing
  free-text `reason` on `stock_movements`. The two work together:

    * `reason_category` = queryable classification for reporting
      ("show all expiry write-offs Q3", "how much did we scrap to
      damage last month by cell"). Small, closed set — validated in
      `Backend.Stock.Movement` schema.
    * `reason` = human-readable specifics ("box crushed by forklift
      at gate 3, driver signed acknowledgement"). Stays free text.

  Column is nullable so existing rows stay valid. Every new manual
  movement (adjust / issue / move / dispose) will be BE-required to
  set both reason + reason_category — that guard lives in the schema
  changeset, not here, so a future admin can still run a scripted
  backfill without fighting a NOT-NULL constraint.
  """

  use Ecto.Migration

  def change do
    alter table(:stock_movements) do
      add :reason_category, :string, size: 32
    end

    # Feeds the "waste log by category" report on the stock dashboard.
    # Partial index (WHERE NOT NULL) — cheaper than a full index while
    # legacy uncategorised rows still exist.
    create index(
             :stock_movements,
             [:company_id, :reason_category, :occurred_at],
             name: :stock_movements_reason_category_idx,
             where: "reason_category IS NOT NULL"
           )
  end
end
