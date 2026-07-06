defmodule Backend.Repo.Migrations.AddCustomerOrderDueDate do
  use Ecto.Migration

  def change do
    # A CO's contractually-agreed customer deadline. Distinct from
    # `expected_ship_date` (that's the internal shipping ETA) — the
    # due_date drives the "Overdue / This week / Later" bucketing on
    # /my-tasks and the wizard's "due in N days" pill. Nullable
    # because pre-existing orders back-fill cleanly.
    alter table(:customer_orders) do
      add :due_date, :date
    end

    create index(:customer_orders, [:due_date])
  end
end
