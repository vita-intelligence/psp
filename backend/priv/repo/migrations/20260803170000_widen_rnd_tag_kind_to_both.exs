defmodule Backend.Repo.Migrations.WidenRndTagKindToBoth do
  use Ecto.Migration

  @moduledoc """
  Allow ``rnd`` to be tagged on racks (storage_locations) as well as
  cells. The effective-tags logic already unions ``cell.tags ∪
  location.tags``, so tagging the rack once cascades to every level
  inside it — much friendlier than tagging every level individually.

  Migration 20260803150000 set ``rnd`` to ``kind = cell`` because
  the item-side meaning was dropped and we thought the tag was
  strictly cell-only. In practice operators want to tag a whole R&D
  rack in one click; forcing them into the cell dialog per level is
  a paper-cut with no upside.

  Down: back to cell-only.
  """

  def change do
    execute(
      "UPDATE storage_tags SET kind = 'both' WHERE key = 'rnd'",
      "UPDATE storage_tags SET kind = 'cell' WHERE key = 'rnd'"
    )
  end
end
