defmodule Backend.Repo.Migrations.AddNpdCustomerFieldsToCustomerOrders do
  use Ecto.Migration

  @moduledoc """
  Mirror the linked customer from NPD onto the CustomerOrder so the
  kanban / project page can render the real client name instead of
  the "NPD Placeholder" stub. Two fields — a display name (what shows
  on the card) and the NPD-side uuid (so a future "match to PSP
  customer" flow can dedupe against PSP's own Customers table).

  Both fields go empty on unlink, and refresh on every subsequent
  ``save_version`` / manual sync — no drift between the two apps.
  """

  def change do
    alter table(:customer_orders) do
      add :npd_customer_uuid, :uuid
      add :npd_customer_display_name, :string, size: 200
    end
  end
end
