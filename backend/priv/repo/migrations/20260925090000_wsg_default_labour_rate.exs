defmodule Backend.Repo.Migrations.WsgDefaultLabourRate do
  @moduledoc """
  Admin-configured fallback labour wage per workstation group. The
  authoritative wage source is the HR session table (per-worker, per
  shift — reality from the kiosk). For a NEW workstation group with
  no sessions yet, cost projections (proposal savings panel, spec
  sheet director-approval breakdown) had no labour signal at all —
  the Labour column simply went blank.

  This field is the operator's "best guess" default that kicks in
  only when no session data exists. The context layer picks:

      labour_rate =
        avg_labour_hourly_rate     # from HR sessions (reality)
        || default_labour_rate_hourly  # admin fallback (this field)
        || nil                     # nothing to project with

  Nullable so legacy groups don't need a backfill. Same precision as
  the existing hourly_rate column.
  """

  use Ecto.Migration

  def change do
    alter table(:workstation_groups) do
      add :default_labour_rate_hourly, :decimal, precision: 14, scale: 4
    end
  end
end
