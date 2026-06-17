defmodule Backend.Repo.Migrations.AddDefaultOperationNotes do
  use Ecto.Migration

  @moduledoc """
  Default SOP / operation notes that auto-fill the
  `operation_description` field on a routing step (or MO step) when
  the workstation group / workstation is picked.

  Lives in two places because the operator can override at the
  station level — a single physical machine inside an otherwise-
  uniform group may have its own quirk worth calling out.

  Resolution order on the routing form is: station-level override
  (when a specific station is chosen) → group default → empty.
  """

  def change do
    alter table(:workstation_groups) do
      add :default_operation_notes, :text
    end

    alter table(:workstations) do
      add :default_operation_notes, :text
    end
  end
end
