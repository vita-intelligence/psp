defmodule Backend.Repo.Migrations.AddSampleKindToCustomerOrders do
  use Ecto.Migration

  # Marks a CustomerOrder as "sample fulfilment" so /projects can
  # distinguish sample runs from commercial orders with a badge.
  # Populated by the NPD sample-sync path
  # (``NpdSync.upsert_sample_from_npd``); false for every CO created
  # via the standard commercial / R&D formulation flows.
  #
  # Not-null with default false so back-fills are trivial and the
  # /projects query never has to defend against nil.
  def change do
    alter table(:customer_orders) do
      add :sample_kind, :boolean, null: false, default: false
    end

    # Partial index — the vast majority of COs are commercial, so an
    # index on ``sample_kind = true`` is much smaller than a full one
    # and answers the "show me the sample projects" query directly.
    create index(:customer_orders, [:sample_kind],
             where: "sample_kind = true",
             name: :customer_orders_sample_kind_idx
           )
  end
end
