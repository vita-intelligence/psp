defmodule Backend.Repo.Migrations.AddReturnTargetToThreePlDispatches do
  @moduledoc """
  Return-to-bailee workflow. When an operator cancels a shipment
  born from a 3PL dispatch, the physical goods are still sitting
  in a dispatch cell — the picker owes a walk back to bailee
  custody. Adds one FK column so we remember the original 3PL
  cell (captured at ``complete_dispatch`` time), and a new
  ``return_pending`` value joins the ``@statuses`` enum on the
  Elixir side (no DB constraint — the enum lives in application
  code).

  Nullable. Rows created before this migration stay valid; the
  cancellation flow requires it, so a legacy Dispatch that had its
  outbound Movement pre-migration will fall back to "any 3PL cell
  in the warehouse" via the mobile suggestions list.
  """

  use Ecto.Migration

  def change do
    alter table(:three_pl_dispatches) do
      add :return_target_cell_id, references(:storage_cells)
    end
  end
end
