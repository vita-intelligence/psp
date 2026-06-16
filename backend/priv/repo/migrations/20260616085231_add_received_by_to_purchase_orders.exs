defmodule Backend.Repo.Migrations.AddReceivedByToPurchaseOrders do
  use Ecto.Migration

  # Mirrors `ordered_by_id` / `submitted_by_id` — stamps the user who
  # carried out the receive. Set by `Backend.Purchasing.receive_against_po/3`
  # at the moment the PO flips to `received` (or `partially_received`).
  # On_delete: nilify so a deactivated user record doesn't take the PO
  # row with it.
  def change do
    alter table(:purchase_orders) do
      add :received_by_id, references(:users, on_delete: :nilify_all)
    end

    create index(:purchase_orders, [:received_by_id])
  end
end
