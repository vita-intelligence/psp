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

  plug RequirePermission, "procurement.po_create" when action in [:index, :projects]

  def index(conn, params) do
    actor = conn.assigns.current_user

    opts = [
      cursor: params["cursor"],
      limit: params["limit"],
      sort: parse_sort(params["sort"]),
      filters: params["filter"] || %{},
      # Per-column filter map — nested-bracket URL params decoded by
      # Plug into ``%{"<field>" => %{"op" => ..., "value" | "min" |
      # "max" | "from" | "to" => ...}}``. Shape mirrors the FE
      # ``serializeColumnFilters`` helper; the shortages service
      # allow-lists the fields it accepts.
      column_filter: params["column_filter"] || %{},
      search: params["search"],
      # Top-level project filter — surfaced as its own query param
      # (not a column filter) because the combobox at the top of the
      # page is page-scoped. Resolves against CustomerOrder.
      # npd_formulation_uuid via the shortage row's dependent-MO root
      # walk.
      formulation_uuid: params["formulation_uuid"]
    ]

    %{items: items, next_cursor: next_cursor} =
      Shortages.list_page(actor.company_id, opts)

    json(conn, %{items: items, next_cursor: next_cursor})
  end

  # GET /api/procurement/shortages/projects
  #
  # Distinct projects currently touched by open-MO shortages. Powers
  # the shortage page's project filter combobox so procurement can
  # scope the queue to one product at a time.
  def projects(conn, _params) do
    actor = conn.assigns.current_user
    projects = Shortages.list_projects(actor.company_id)
    json(conn, %{projects: projects})
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
