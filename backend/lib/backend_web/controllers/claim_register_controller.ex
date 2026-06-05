defmodule BackendWeb.ClaimRegisterController do
  @moduledoc """
  Read-only access to the regulator claim register. Supports paginated
  search by category, nutrient, status, or text.

  Requires `items.view` — claims are only relevant on the
  finished-product spec subtable, which is gated by items access.
  """

  use BackendWeb, :controller

  alias Backend.Claims
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "items.view"

  def index(conn, params) do
    opts = [
      cursor: params["cursor"],
      limit: params["limit"],
      sort: parse_sort(params["sort"]),
      search: params["search"],
      category: params["category"],
      status: params["status"],
      source: params["source"],
      nutrient_substance: params["nutrient_substance"]
    ]

    {items, next_cursor} = Claims.list_page(opts)

    json(conn, %{
      items: Enum.map(items, &Payloads.claim/1),
      next_cursor: next_cursor
    })
  end

  defp parse_sort(nil), do: nil
  defp parse_sort(""), do: nil

  defp parse_sort(s) when is_binary(s) do
    case String.split(s, ":", parts: 2) do
      [field, "asc"] -> {String.to_existing_atom(field), :asc}
      [field, "desc"] -> {String.to_existing_atom(field), :desc}
      _ -> nil
    end
  rescue
    ArgumentError -> nil
  end
end
