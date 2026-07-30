defmodule Backend.Repo.Migrations.AddNpdTeamFieldsToCustomerOrders do
  use Ecto.Migration

  @moduledoc """
  Denormalised name + link fields from NPD's `save_version` payload
  so the PSP project page can show "R&D lead: X · Sales: Y · Open on
  NPD" without a live round-trip to vita-cff on every page render.

  All three are optional strings — R&D projects may not have either
  role assigned yet, and the app URL is only present when NPD's own
  base URL is configured on its side.
  """

  def change do
    alter table(:customer_orders) do
      add :npd_lead_scientist_name, :string, size: 200
      add :npd_sales_person_name, :string, size: 200
      # 500 chars is deep-enough for any reasonable NPD URL (base URL +
      # `/<locale>/formulations/<uuid>`) with headroom for query-string
      # additions later.
      add :npd_app_url, :string, size: 500
    end
  end
end
