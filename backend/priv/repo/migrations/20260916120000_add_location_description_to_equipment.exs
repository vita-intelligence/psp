defmodule Backend.Repo.Migrations.AddLocationDescriptionToEquipment do
  @moduledoc """
  Free-text location for equipment that doesn't live in a storage
  cell — office monitors, boardroom TVs, reception AV, meter cupboards.
  The detail page's "where is it" line reads assigned_to → current_cell
  → location_description → "—", so an operator can set exactly one and
  the UI shows the right level of precision.
  """

  use Ecto.Migration

  def change do
    alter table(:equipment) do
      add :location_description, :text
    end
  end
end
