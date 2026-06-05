defmodule BackendWeb.AllergenController do
  @moduledoc """
  Read-only access to the EU 1169/2011 Annex II declared-allergens
  lookup. Requires `items.view` since the only consumer is the items
  form.
  """

  use BackendWeb, :controller

  alias Backend.Allergens
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "items.view"

  def index(conn, _params) do
    items = Allergens.list_all()
    json(conn, %{items: Enum.map(items, &Payloads.allergen/1)})
  end
end
