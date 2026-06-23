defmodule BackendWeb.ProcurementShortagesController do
  @moduledoc """
  Read-only feed of items short for open MOs. Procurement uses this
  as their "what to order next" worklist — single page, no per-row
  state, just totals + dependent MOs.
  """

  use BackendWeb, :controller

  alias Backend.Procurement.Shortages
  alias BackendWeb.Plugs.RequirePermission

  action_fallback BackendWeb.FallbackController

  plug RequirePermission, "procurement.po_create" when action in [:index]

  def index(conn, params) do
    actor = conn.assigns.current_user

    opts = [
      cursor: params["cursor"],
      limit: params["limit"],
      sort: parse_sort(params["sort"]),
      filters: params["filter"] || %{},
      search: params["search"]
    ]

    %{items: items, next_cursor: next_cursor} =
      Shortages.list_page(actor.company_id, opts)

    json(conn, %{items: items, next_cursor: next_cursor})
  end

  # Parse "field:direction" → %{field: ..., direction: ...}. The
  # DataTable component sends a single string per call.
  defp parse_sort(nil), do: nil
  defp parse_sort(""), do: nil

  defp parse_sort(spec) when is_binary(spec) do
    case String.split(spec, ":") do
      [field, dir] when dir in ["asc", "desc"] -> %{field: field, direction: dir}
      [field] -> %{field: field, direction: "asc"}
      _ -> nil
    end
  end

  defp parse_sort(_), do: nil
end
