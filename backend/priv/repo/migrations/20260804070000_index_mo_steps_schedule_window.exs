defmodule Backend.Repo.Migrations.IndexMoStepsScheduleWindow do
  use Ecto.Migration

  # Composite index for the production-schedule window query
  # (`Backend.Production.list_schedule_operations/4`).
  #
  # Schedule fetches every step whose planned window overlaps the
  # visible date range, scoped to a company + warehouse (warehouse
  # comes through the MO join, company sits on the step). At low
  # volume the query is fast even without an index because the plan
  # falls back to a sequential scan of a small table; at millions of
  # rows PG needs a targeted index to clip the visible page in
  # sub-100ms.
  #
  # Partial (`WHERE planned_start IS NOT NULL`) so unscheduled steps
  # — the vast majority in a healthy queue — never enter the index.
  # Ordered by `planned_start` so `s.planned_finish >= from` +
  # `s.planned_start <= to` bounds range-scan the leading key.
  #
  # `concurrently: true` + `@disable_ddl_transaction true` so a
  # future prod deploy doesn't take a lock on a hot table.
  @disable_ddl_transaction true
  @disable_migration_lock true

  def change do
    create index(
             :manufacturing_order_steps,
             [:company_id, :planned_start, :planned_finish],
             name: :mo_steps_schedule_window_idx,
             where: "planned_start IS NOT NULL",
             concurrently: true
           )
  end
end
