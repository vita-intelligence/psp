defmodule Backend.Repo.Migrations.AddNpdFormulationUuidToCustomerOrders do
  use Ecto.Migration

  @moduledoc """
  Link a CustomerOrder to the NPD (vita-cff) formulation it originated
  from. Populated by NPD's ``save_version`` cascade — every time the
  scientist hits Save on a formulation, NPD pushes a sync payload that
  upserts the CO by this key. First-seen inserts land as ``status:
  "draft"`` with ``npd_formulation_uuid`` planted; subsequent hits
  refresh the identity fields.

  Nullable — pre-integration COs stay unlinked. Unique per company so
  a stale re-sync can't create a duplicate CO for the same formulation.
  """

  def change do
    alter table(:customer_orders) do
      add :npd_formulation_uuid, :uuid
    end

    create unique_index(:customer_orders, [:company_id, :npd_formulation_uuid],
             name: :customer_orders_npd_formulation_uuid_index,
             where: "npd_formulation_uuid IS NOT NULL"
           )
  end
end
