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

  alias Backend.{RBAC, Warehouses}
  alias Backend.Realtime.RateLimit
  alias BackendWeb.Presence

  # Hard cap on the JSON-encoded size of a `canvas:patch` payload.
  # Legit patches are ~5-20 KB; a hostile client could otherwise
  # broadcast megabytes-per-message and pin every peer's decoder.
  @max_canvas_bytes 100_000

  @impl true
  def join("plan:warehouse:" <> warehouse_uuid, _params, socket) do
    # The user (with permissions[] preloaded) is already on the
    # socket from UserSocket.connect — no reason to re-fetch here.
    # A just-revoked permission takes effect on the next reconnect,
    # which for a Miro-style planner is a fair tradeoff to save a
    # query on every tab switch.
    user = socket.assigns.current_user

    cond do
      not RBAC.has_permission?(user, "warehouses.view") ->
        {:error, %{reason: "forbidden"}}

      Warehouses.get_for_company(user.company_id, warehouse_uuid) == nil ->
        {:error, %{reason: "not_found"}}

      true ->
        send(self(), :after_join)

        socket =
          socket
          |> assign(:warehouse_uuid, warehouse_uuid)
          # Cache edit capability on assigns so future message
          # handlers can gate without another permission lookup.
          # The plan channel is broadcast-only today (mutations
          # go through HTTP), but the flag is here for the
          # autosave-take-over handoff message that lands next.
          |> assign(:can_edit, RBAC.has_permission?(user, "warehouses.edit"))

        {:ok, %{user_id: user.id, can_edit: socket.assigns.can_edit}, socket}
    end
  end

  @impl true
  def handle_info(:after_join, socket) do
    user = socket.assigns.current_user

    {:ok, _ref} =
      Presence.track(socket, "#{user.id}", %{
        name: user.name,
        avatar: user.avatar,
        user_id: user.id,
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

  # Head-of-room handoff. Any peer can request to take over; the
  # current creator's client is expected to respond by pushing
  # `handoff:step-down` on itself, which sets `stepped_down: true`
  # on their presence meta. Since the "who's creator" computation
  # (earliest joiner among non-stepped-down peers) lives on the
  # client, the server just fans this out and lets peers coordinate.
  # No auth on the request — the collab pattern already caps the
  # room at 10 people and only warehouses.view is required to join.
  @impl true
  def handle_in("handoff:take-over", _payload, socket) do
    broadcast_from!(socket, "handoff:take-over", %{
      by: socket.assigns.current_user.id
    })

    {:noreply, socket}
  end

  @impl true
  def handle_in("handoff:step-down", _payload, socket) do
    user = socket.assigns.current_user

    Presence.update(socket, "#{user.id}", fn meta ->
      Map.put(meta, :stepped_down, true)
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
  @impl true
  def handle_in(
        "canvas:patch",
        %{"floor_uuid" => floor_uuid, "canvas" => canvas},
        socket
      )
      when is_binary(floor_uuid) and is_map(canvas) do
    with {:ok, socket} <- RateLimit.check(socket, :canvas_patch),
         :ok <- check_canvas_size(canvas) do
      broadcast_from!(socket, "canvas:patch", %{
        by: socket.assigns.current_user.id,
        floor_uuid: floor_uuid,
        canvas: canvas,
        ts: System.system_time(:millisecond)
      })

      {:noreply, socket}
    else
      {:limited, socket} -> {:noreply, socket}
      {:error, :too_large} -> {:noreply, socket}
    end
  end

  defp check_canvas_size(canvas) do
    encoded = Jason.encode!(canvas)

    if byte_size(encoded) > @max_canvas_bytes do
      {:error, :too_large}
    else
      :ok
    end
  end

  # Late-joiner catch-up. The channel doesn't store state, so when a
  # new tab joins it asks for a snapshot of whatever in-progress
  # work the room currently has. Any existing peer is eligible to
  # respond; receivers dedupe by acting on the first arrival.
  @impl true
  def handle_in("snapshot:request", _payload, socket) do
    broadcast_from!(socket, "snapshot:request", %{
      by: socket.assigns.current_user.id
    })

    {:noreply, socket}
  end

  # `to` is the joining user_id the snapshot is addressed to. The
  # receiving client filters on it so a roomful of peers don't all
  # apply the same snapshot.
  @impl true
  def handle_in(
        "snapshot:response",
        %{"to" => to, "floors" => floors},
        socket
      )
      when is_list(floors) do
    broadcast_from!(socket, "snapshot:response", %{
      by: socket.assigns.current_user.id,
      to: to,
      floors: floors,
      ts: System.system_time(:millisecond)
    })

    {:noreply, socket}
  end

  def handle_in(_event, _payload, socket), do: {:noreply, socket}
end
