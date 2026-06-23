defmodule Backend.Repo.Migrations.AddMoNeedsReplanFields do
  use Ecto.Migration

  # Replan regression — when an MO that's already past `approved` hits
  # trouble (Output QC fails, peer MO over-consumed a booked lot, a
  # lot got QC-rejected after release) it has to bounce back to the
  # planner. The cleanest model is to keep the status state machine
  # simple (regress to `approved`) AND surface a parallel `needs_replan`
  # flag that:
  #
  #   * shows a "Needs replan" badge instead of "Approved" in the UI
  #   * blocks `release_mo_to_warehouse` until the planner clears it
  #     by re-running through bookings
  #
  # `needs_replan_reason` is free text recorded by the trigger so the
  # planner sees WHY without digging through the audit log.
  def change do
    alter table(:manufacturing_orders) do
      add :needs_replan, :boolean, null: false, default: false
      add :needs_replan_reason, :text
      add :needs_replan_at, :utc_datetime
    end

    create index(:manufacturing_orders, [:needs_replan],
             where: "needs_replan = true",
             name: :manufacturing_orders_needs_replan_partial_idx
           )
  end
end
