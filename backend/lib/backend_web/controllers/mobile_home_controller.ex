defmodule BackendWeb.MobileHomeController do
  @moduledoc """
  Slim badge-count endpoint for the /m mobile home page.

      GET /api/m/home-counts

  Returns one integer per tile the operator can see, so the FE can
  render a numeric bubble without loading every queue list just to
  read `.length`. Runs targeted capped-COUNT queries via
  `Backend.Mobile.home_counts/1` — each stays O(cap) regardless of
  underlying table size.

  Permission-scoped: the response omits counts for buckets the caller
  doesn't have permission to see. Admins get everything. Any count
  the operator's tile is hidden for wouldn't be rendered by the FE
  anyway, but skipping it here also saves the query.
  """

  use BackendWeb, :controller

  alias Backend.Mobile
  alias Backend.RBAC

  action_fallback BackendWeb.FallbackController

  def counts(conn, _params) do
    actor = conn.assigns.current_user
    counts = Mobile.home_counts(actor.company_id)

    json(conn, %{
      cap: Mobile.cap(),
      counts: filter_by_permission(counts, actor)
    })
  end

  # Each key on the counts map corresponds to a mobile tile and its
  # RBAC permission (mirrors MOBILE_HOME_TILES on the FE). Nil-out
  # any bucket the caller can't see — the FE never renders a badge
  # for a hidden tile, so zeroing it costs nothing.
  defp filter_by_permission(counts, actor) do
    counts
    |> Enum.map(fn {key, value} ->
      perm = permission_for(key)

      cond do
        perm == nil -> {key, value}
        actor.is_admin -> {key, value}
        RBAC.has_permission?(actor, perm) -> {key, value}
        true -> {key, 0}
      end
    end)
    |> Map.new()
  end

  # RBAC key per bucket. Keep in sync with the tile registry in
  # client/src/app/m/mobile-home-shell.tsx (MOBILE_HOME_TILES).
  defp permission_for(:pickup), do: "warehouse.pick"
  defp permission_for(:preflight), do: "production.preflight"
  defp permission_for(:closeout), do: "production.closeout"
  defp permission_for(:putaway), do: "stock.move"
  defp permission_for(:incoming_today), do: "goods_in.inspect"
  defp permission_for(:submitted_inspections), do: "goods_in.view"
  defp permission_for(:return_pickup), do: "warehouse.return_pickup"
  defp permission_for(:three_pl_dispatch), do: "three_pl.dispatch_execute"
  defp permission_for(_), do: nil
end
