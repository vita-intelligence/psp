defmodule BackendWeb.WarehousePlanChannel do
  @moduledoc """
  Live collaboration for the warehouse plan editor.

  Topic format: `plan:warehouse:<warehouse_uuid>`. One channel per
  warehouse — every floor of that warehouse shares the same room so
  presence is consistent regardless of which floor the user happens
  to be viewing.

  Server → client events:

    * `presence_state` / `presence_diff` — standard Phoenix.Presence,
      so the plan tab can show an avatar stack of who else is here.
    * `floor:invalidated` — `%{floor_uuid, by_user_id, kind}`. Fired
      by the HTTP controllers AFTER persisting a change (floor save,
      location create / update / delete, hole edits, …). Tells peers
      "the truth in the DB just moved; refetch when it's safe."

  Server-side broadcasts only — peers don't push edits over this
  channel. Mutations always go through the existing REST endpoints
  so the audit trail stays authoritative; the channel is purely the
  fan-out that tells other tabs to refresh.

  Auth: `warehouses.view` on the target warehouse (any tab open in
  the plan tab can sit in the room; only `warehouses.edit` can
  actually save, but that's gated by the HTTP layer).
  """

  use Phoenix.Channel

  alias Backend.{Accounts, RBAC, Warehouses}
  alias BackendWeb.Presence

  @impl true
  def join("plan:warehouse:" <> warehouse_uuid, _params, socket) do
    cached = socket.assigns.current_user
    user = Accounts.get_user(cached.id) || cached

    cond do
      not RBAC.has_permission?(user, "warehouses.view") ->
        {:error, %{reason: "forbidden"}}

      Warehouses.get_for_company(user.company_id, warehouse_uuid) == nil ->
        {:error, %{reason: "not_found"}}

      true ->
        send(self(), :after_join)

        socket =
          socket
          |> assign(:current_user, user)
          |> assign(:warehouse_uuid, warehouse_uuid)

        {:ok, %{user_id: user.id}, socket}
    end
  end

  @impl true
  def handle_info(:after_join, socket) do
    user = socket.assigns.current_user

    {:ok, _ref} =
      Presence.track(socket, "#{user.id}", %{
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        active_floor_uuid: nil,
        joined_at: System.system_time(:second)
      })

    push(socket, "presence_state", Presence.list(socket))
    {:noreply, socket}
  end

  # Optional client → server message: "I'm now looking at floor X".
  # Surfaces in the presence meta so other peers can show "Maria is
  # on the mezzanine" in the avatar tooltip.
  @impl true
  def handle_in("floor:focus", %{"floor_uuid" => floor_uuid}, socket)
      when is_binary(floor_uuid) or is_nil(floor_uuid) do
    user = socket.assigns.current_user

    Presence.update(socket, "#{user.id}", fn meta ->
      %{meta | active_floor_uuid: floor_uuid}
    end)

    {:noreply, socket}
  end

  # Live cursor — `x` and `y` are world centimetres on the floor
  # the cursor is hovering. Sender + receiver both render in world
  # coords so different zoom levels and screen sizes still line up.
  # Pure broadcast: no presence meta, no persistence. Disappears on
  # `cursor:hide` or when the user leaves the channel.
  @impl true
  def handle_in(
        "cursor:move",
        %{"floor_uuid" => floor_uuid, "x" => x, "y" => y},
        socket
      )
      when is_binary(floor_uuid) and is_number(x) and is_number(y) do
    broadcast_from!(socket, "cursor:move", %{
      by: socket.assigns.current_user.id,
      floor_uuid: floor_uuid,
      x: x,
      y: y
    })

    {:noreply, socket}
  end

  @impl true
  def handle_in("cursor:hide", _payload, socket) do
    broadcast_from!(socket, "cursor:hide", %{
      by: socket.assigns.current_user.id
    })

    {:noreply, socket}
  end

  # Live canvas state — mid-edit fan-out of the active floor's
  # canvas_json so peers see walls / outline / hole changes appear
  # in real time, not just on save. The sender debounces (~250ms)
  # to keep traffic reasonable; receivers replace their local
  # canvas if they're on the same floor and aren't mid-drag.
  #
  # Locations stay out of this stream — they're first-class DB rows
  # with their own create/update/delete endpoints, so we keep them
  # on the existing `floor:invalidated` save broadcast.
  @impl true
  def handle_in(
        "canvas:patch",
        %{"floor_uuid" => floor_uuid, "canvas" => canvas},
        socket
      )
      when is_binary(floor_uuid) and is_map(canvas) do
    broadcast_from!(socket, "canvas:patch", %{
      by: socket.assigns.current_user.id,
      floor_uuid: floor_uuid,
      canvas: canvas,
      ts: System.system_time(:millisecond)
    })

    {:noreply, socket}
  end

  def handle_in(_event, _payload, socket), do: {:noreply, socket}
end
