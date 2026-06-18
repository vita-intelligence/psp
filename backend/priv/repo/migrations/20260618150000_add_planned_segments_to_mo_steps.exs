defmodule Backend.Repo.Migrations.AddPlannedSegmentsToMoSteps do
  use Ecto.Migration

  # Stores the explicit ordered list of WORK segments the planner
  # pinned for an operation via the click-to-edit dialog. Pauses
  # are derived from the gaps between consecutive segments.
  #
  # When NULL, the schedule walker derives segments at render time
  # from planned_start + planned_duration_seconds + working windows.
  # When set, this is the source of truth — the walker stays out.
  #
  # Shape: [%{"start_at" => iso8601, "finish_at" => iso8601}, ...]
  def change do
    alter table(:manufacturing_order_steps) do
      add :planned_segments, :jsonb
    end
  end
end
