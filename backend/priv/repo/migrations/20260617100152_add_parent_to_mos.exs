defmodule Backend.Repo.Migrations.AddParentToMos do
  use Ecto.Migration

  @moduledoc """
  Parent / child MO chain. An FG MO whose BOM needs a semi-finished
  the stock can't cover auto-spawns one child MO per shortfall; that
  child can recurse the same way. The parent can't transition to
  `in_progress` until every child reaches `completed`.

  `on_delete: :nilify_all` so cancelling a parent doesn't cascade-
  delete child runs that may have already produced stock. The
  context layer enforces the cancel rules.
  """

  def change do
    alter table(:manufacturing_orders) do
      add :parent_mo_id, references(:manufacturing_orders, on_delete: :nilify_all)
    end

    create index(:manufacturing_orders, [:parent_mo_id])
  end
end
