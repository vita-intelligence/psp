defmodule Backend.Repo.Migrations.DropMachinesTable do
  @moduledoc """
  Phase B closeout. The `machines` table has been merged into
  `equipment` (its physical-asset twin) — running-cost + attachment
  live there now. This migration drops the vestigial table.

  Reverse direction is a no-op — the schema, controller, payloads,
  and FE surface are all gone in the same PR, so recreating the
  bare table wouldn't bring the CRUD back. If you need to roll
  back, restore from a snapshot rather than re-run `migrate down`.
  """

  use Ecto.Migration

  def up do
    drop_if_exists table(:machines)
  end

  def down do
    :ok
  end
end
