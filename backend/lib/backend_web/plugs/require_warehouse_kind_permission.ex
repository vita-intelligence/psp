defmodule BackendWeb.Plugs.RequireWarehouseKindPermission do
  @moduledoc """
  Permission gate for nested resources under a warehouse (floors,
  storage locations, storage cells) that respects the parent
  warehouse's `kind` discriminator.

  Surfaces sharing the same nested controllers (`/warehouses/:id/...`
  for `kind=warehouse` and `/production-facilities/:id/...` for
  `kind=production_facility`) both pass the parent uuid as
  `warehouse_id` in the URL. This plug loads that parent, reads its
  kind, and gates against the kind-specific permission code:

      plug BackendWeb.Plugs.RequireWarehouseKindPermission,
        warehouse: "warehouses.edit",
        production_facility: "production.facility_edit"

  If either the parent is missing or in another company, returns 404
  via the standard fallback path. If the user lacks the kind-specific
  permission, returns 403.

  Per-action gating works through the `:when` macro the controller
  passes — same shape as `RequirePermission`.
  """

  import Plug.Conn
  alias Backend.RBAC
  alias Backend.Warehouses
  alias BackendWeb.Errors

  def init(opts) when is_list(opts) do
    warehouse = Keyword.fetch!(opts, :warehouse)
    production_facility = Keyword.fetch!(opts, :production_facility)
    %{warehouse: warehouse, production_facility: production_facility}
  end

  def call(conn, %{warehouse: wh_code, production_facility: pf_code}) do
    user = conn.assigns[:current_user]
    parent_uuid = conn.params["warehouse_id"]

    with %Backend.Warehouses.Warehouse{kind: kind} <-
           Warehouses.get_for_company(user.company_id, parent_uuid),
         code <- code_for_kind(kind, wh_code, pf_code),
         true <- RBAC.has_permission?(user, code) do
      conn
    else
      nil ->
        # Parent warehouse is gone (or another company's). Treat as not
        # found rather than forbidden so we don't leak existence.
        send_error(conn, 404, "not_found", "Parent warehouse not found.")

      false ->
        send_error(
          conn,
          403,
          "forbidden",
          "You don't have permission to perform this action."
        )
    end
  end

  defp code_for_kind("warehouse", wh, _pf), do: wh
  defp code_for_kind("production_facility", _wh, pf), do: pf

  defp send_error(conn, status, code, detail) do
    body = Errors.payload(code, detail)

    conn
    |> put_resp_content_type("application/json")
    |> send_resp(status, Jason.encode!(body))
    |> halt()
  end
end
