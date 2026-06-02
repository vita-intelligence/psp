defmodule Backend.Repo.Migrations.AddStateAfterToAuditEvents do
  use Ecto.Migration

  @moduledoc """
  Adds `state_after` JSONB to audit_events. This stores the full
  audit-field snapshot at the moment AFTER each event so the
  "Restore version" button in the UI can repopulate a form with
  exactly what the record looked like at that point in time —
  without having to walk every previous diff backwards from the
  current state.

  Storage cost is modest: audit-field surfaces are small (warehouse:
  ~9 columns, user: 3, template: 3) and we keep the values themselves,
  not Ecto changesets. The trade-off — bigger rows for simpler reads —
  is the right one for a feature that the UI hits on every history
  view.
  """

  def change do
    alter table(:audit_events) do
      add :state_after, :map, null: false, default: %{}
    end
  end
end
