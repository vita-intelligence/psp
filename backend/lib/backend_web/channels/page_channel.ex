defmodule BackendWeb.PageChannel do
  @moduledoc """
  Universal page-scoped presence + head-of-room lock + cursor sync.

  Topic shape: `page:<path>` where `path` is a URL-safe encoded route
  string (e.g. `page:%2Fsales%2Forders%2Fabc-uuid`). One channel per
  distinct route, so two users on the SAME record share a room, while a
  user on the vendors list and a user on the vendors detail get
  separate rooms.

  Unlike `form:<resource>:<id>` there's no per-resource RBAC check at
  join time — anyone in the same company who's already authenticated
  (which is the socket-connect gate) can join any page room they can
  navigate to. The client-side lock is what protects mutations: only
  the earliest joiner (`isLeader`) sees enabled action buttons.

  Events sent **from** the client:

    * `cursor:move`  — `%{x, y}` normalised 0..1 against the anchor
                       element. Pure broadcast, no persistence.
    * `cursor:hide`  — no payload. Peer moves off-page or blurs.

  Events sent **to** the client:

    * `cursor:move`  — rebroadcast, augmented with `%{from: user_id}`.
    * `cursor:hide`  — rebroadcast with `%{from: user_id}`.
    * `presence_state` / `presence_diff` — standard Phoenix.Presence.

  Presence meta carried per peer:

    * `name`, `email`, `avatar` — for the avatar stack + cursor label.
    * `joined_at` — unix seconds. The lowest value wins leadership.

  Head-of-room is derived client-side from the presence list — the
  peer whose `joined_at` is earliest is leader. On tie, sort by user
  id (stable). If the leader disconnects, presence_diff fires; the
  next-earliest peer promotes automatically.
  """

  use Phoenix.Channel

  alias Backend.Accounts
  alias BackendWeb.Presence

  # Soft cap on peers per page. High because a schedule / kanban board
  # can legitimately have a whole team on it. The avatar stack collapses
  # past 5 anyway so a big number is only a memory concern, not a UI
  # one.
  @default_room_limit 25

  @impl true
  def join("page:" <> path, _params, socket) do
    # Re-read the user for the same reason FormChannel does — an admin
    # may have granted a permission since the socket opened.
    cached = socket.assigns.current_user
    user = Accounts.get_user(cached.id) || cached

    cond do
      path == "" ->
        {:error, %{reason: "bad_topic"}}

      room_full?("page:" <> path) ->
        {:error, %{reason: "room_full", limit: @default_room_limit}}

      true ->
        send(self(), :after_join)

        socket =
          socket
          |> assign(:current_user, user)
          |> assign(:page_path, path)

        {:ok, %{user_id: user.id, limit: @default_room_limit}, socket}
    end
  end

  @impl true
  def handle_info(:after_join, socket) do
    user = socket.assigns.current_user
    now = System.system_time(:second)

    {:ok, _ref} =
      Presence.track(socket, "#{user.id}", %{
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        joined_at: now
      })

    push(socket, "presence_state", Presence.list(socket))
    {:noreply, socket}
  end

  # Pure broadcast — cursor moves never touch the DB. Rebroadcast to
  # everyone else with a `from` stamp so the receiver can look up which
  # peer moved.
  @impl true
  def handle_in("cursor:move", %{"x" => x, "y" => y}, socket) do
    broadcast_from!(socket, "cursor:move", %{
      from: socket.assigns.current_user.id,
      x: clamp_unit(x),
      y: clamp_unit(y)
    })

    {:noreply, socket}
  end

  @impl true
  def handle_in("cursor:hide", _payload, socket) do
    broadcast_from!(socket, "cursor:hide", %{
      from: socket.assigns.current_user.id
    })

    {:noreply, socket}
  end

  # Unknown event names are dropped silently — pages send whatever the
  # local hook thinks is useful; we don't want a version-drift crash.
  def handle_in(_event, _payload, socket), do: {:noreply, socket}

  ## ------------------------------------------------------------------

  defp room_full?(topic) do
    map_size(Presence.list(topic)) >= @default_room_limit
  end

  defp clamp_unit(v) when is_number(v) do
    cond do
      v < 0 -> 0.0
      v > 1 -> 1.0
      true -> v * 1.0
    end
  end

  defp clamp_unit(_), do: 0.0
end
