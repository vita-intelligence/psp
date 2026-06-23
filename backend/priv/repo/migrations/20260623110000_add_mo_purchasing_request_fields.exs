defmodule Backend.Repo.Migrations.AddMoPurchasingRequestFields do
  use Ecto.Migration

  # Procurement request gate — planner books what's available, then
  # explicitly "Requests purchases" for the rest. From that point:
  #
  #   * MO renders as "Purchasing" instead of "Draft"
  #   * Existing bookings are locked (no add/edit/delete)
  #   * Shortages page filters to MOs with this flag set
  #
  # Cleared automatically when the planner prepares the MO (the next
  # forward step in the approval workflow). Also clearable via an
  # explicit Cancel action while still in draft.
  def change do
    alter table(:manufacturing_orders) do
      add :purchasing_requested_at, :utc_datetime
      add :purchasing_requested_by_id, references(:users, on_delete: :nilify_all)
    end

    create index(:manufacturing_orders, [:purchasing_requested_at],
             where: "purchasing_requested_at IS NOT NULL",
             name: :manufacturing_orders_purchasing_requested_partial_idx
           )
  end
end
