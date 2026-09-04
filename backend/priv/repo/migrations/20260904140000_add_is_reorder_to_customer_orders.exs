defmodule Backend.Repo.Migrations.AddIsReorderToCustomerOrders do
  @moduledoc """
  Adds ``is_reorder`` boolean to ``customer_orders`` so PSP can
  distinguish reorder-COs (customer re-buying a signed Custom
  formulation via the portal) from bespoke Custom COs whose
  ``npd_project_type`` is also ``"custom"``.

  Reorder-COs share Custom's ``npd_project_type`` but must behave
  like RTG-COs on rejection / deletion — each proposal IS the CO's
  reason for existence, so when the proposal dies the CO row must
  disappear too. Without this column ``unmerge_from_proposal``
  can't tell reorder-COs apart from Custom-COs and would leave
  orphan cards on the /projects kanban.

  Default ``false`` + backfilled on existing rows via the default —
  legacy Custom + RTG COs are unaffected. NPD's proposal-merge
  payload now carries ``npd_is_reorder`` which
  ``apply_proposal_identity`` stamps onto this column.
  """

  use Ecto.Migration

  def up do
    alter table(:customer_orders) do
      add :is_reorder, :boolean, default: false, null: false
    end

    # Indexed to keep the kanban / cleanup queries cheap. Partial
    # index on ``true`` because the fraction of reorder rows is
    # tiny relative to the whole CO population.
    create index(:customer_orders, [:company_id, :is_reorder],
             where: "is_reorder = true",
             name: :customer_orders_is_reorder_index
           )
  end

  def down do
    drop_if_exists index(:customer_orders, [:company_id, :is_reorder],
                     name: :customer_orders_is_reorder_index
                   )

    alter table(:customer_orders) do
      remove :is_reorder
    end
  end
end
