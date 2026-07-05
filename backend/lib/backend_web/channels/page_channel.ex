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

  alias Backend.{Accounts, Tenancy}
  alias Backend.Realtime.RateLimit
  alias BackendWeb.Presence

  # Soft cap on peers per page. High because a schedule / kanban board
  # can legitimately have a whole team on it. The avatar stack collapses
  # past 5 anyway so a big number is only a memory concern, not a UI
  # one.
  @default_room_limit 25

  @impl true
  def join("page:" <> path, params, socket) do
    # Re-read the user for the same reason FormChannel does — an admin
    # may have granted a permission since the socket opened.
    cached = socket.assigns.current_user
    user = Accounts.get_user(cached.id) || cached

    decoded = URI.decode(path)

    cond do
      path == "" ->
        {:error, %{reason: "bad_topic"}}

      not path_visible_to?(user, decoded) ->
        # Entity-detail pages: verify the referenced record lives in
        # the actor's tenant. Without this, an authenticated user
        # from tenant A could subscribe to `page:/procurement/vendors/<uuid>`
        # for a vendor uuid that belongs to tenant B, and see the
        # presence roster (names, emails, avatars, viewport dims) of
        # the peers on that page.
        {:error, %{reason: "forbidden"}}

      room_full?("page:" <> path) ->
        {:error, %{reason: "room_full", limit: @default_room_limit}}

      true ->
        send(self(), :after_join)

        socket =
          socket
          |> assign(:current_user, user)
          |> assign(:page_path, path)
          |> assign(:join_viewport, viewport_from_params(params))

        {:ok, %{user_id: user.id, limit: @default_room_limit}, socket}
    end
  end

  # Detail routes with a uuid in the path resolve to a tenant-scoped
  # record — check it belongs to the user's company. Global surfaces
  # (list pages, dashboards, settings) are visible to anyone
  # authenticated in the tenant, so they pass through.
  defp path_visible_to?(user, path) do
    case Tenancy.classify_path(path) do
      {:entity, resource, uuid} ->
        Tenancy.resource_in_tenant?(user, resource, uuid)

      :global ->
        true

      :unknown ->
        # Routes we haven't classified — list pages, admin dashboards,
        # newly-added surfaces. Presence on these doesn't leak record
        # data across tenants (list pages don't embed foreign UUIDs
        # in their path), and the socket-connect auth has already
        # gated for tenant membership, so we allow through. The
        # specific cross-tenant attack (`/procurement/vendors/<uuid>`)
        # goes through the `:entity` branch above.
        true
    end
  end

  @impl true
  def handle_info(:after_join, socket) do
    user = socket.assigns.current_user
    now = System.system_time(:second)
    viewport = socket.assigns[:join_viewport]

    {:ok, _ref} =
      Presence.track(socket, "#{user.id}", %{
        name: user.name,
        avatar: user.avatar,
        user_id: user.id,
        joined_at: now,
        viewport_w: viewport[:w],
        viewport_h: viewport[:h]
      })

    push(socket, "presence_state", Presence.list(socket))
    {:noreply, socket}
  end

  # Alt+click "point at this element" gesture — collab_id refers to a
  # `data-collab-id` attribute on the sender's DOM; receiver looks for
  # the matching element and pulses it. Reflow-safe: the element may
  # be at a different pixel location on the receiver's screen, but
  # it's the same data.
  @impl true
  def handle_in("point:element", %{"collab_id" => collab_id}, socket)
      when is_binary(collab_id) do
    broadcast_from!(socket, "point:element", %{
      from: socket.assigns.current_user.id,
      collab_id: collab_id
    })

    {:noreply, socket}
  end

  # Pure broadcast — cursor moves never touch the DB. Rebroadcast to
  # everyone else with a `from` stamp so the receiver can look up which
  # peer moved.
  @impl true
  def handle_in("cursor:move", %{"x" => x, "y" => y}, socket) do
    case RateLimit.check(socket, :cursor) do
      {:ok, socket} ->
        broadcast_from!(socket, "cursor:move", %{
          from: socket.assigns.current_user.id,
          x: clamp_unit(x),
          y: clamp_unit(y)
        })

        {:noreply, socket}

      {:limited, socket} ->
        {:noreply, socket}
    end
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

  # Parse {viewport_w, viewport_h} out of the join params. Clamp to
  # sane bounds so a hostile client can't stuff nonsense.
  defp viewport_from_params(%{"viewport_w" => w, "viewport_h" => h}) do
    %{w: clamp_dim(w), h: clamp_dim(h)}
  end

  defp viewport_from_params(_), do: %{w: nil, h: nil}

  defp clamp_dim(n) when is_integer(n) and n > 0 and n < 20_000, do: n

  defp clamp_dim(n) when is_number(n) and n > 0 and n < 20_000,
    do: trunc(n)

  defp clamp_dim(_), do: nil
end
