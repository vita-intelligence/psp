defmodule BackendWeb.LobbyChannel do
  @moduledoc """
  Single "lobby" channel everyone joins on login. Tracks who's online
  (drives the avatar dot on the home screen and the connection pill in
  the top bar) AND which form a user is currently focused on, so the
  list views can show "Alice is editing London HQ" indicators without
  every list needing its own presence subscription.

  The `current_form` field is `"<resource>:<id>"` or `nil`. Pushed via
  the `meta:update` event from the client when they navigate onto a
  form route or leave it.
  """

  use Phoenix.Channel

  alias BackendWeb.Presence

  # Every user in the app joins one shared `"lobby"` topic. Presence
  # deltas are intercepted so a joining socket only ever sees peers
  # from the same company — otherwise the lobby is a cross-tenant
  # roster of everyone signed in (name / avatar / email leak).
  intercept(["presence_state", "presence_diff"])

  @impl true
  def join("lobby", _params, socket) do
    send(self(), :after_join)
    {:ok, socket}
  end

  @impl true
  def handle_info(:after_join, socket) do
    user = socket.assigns.current_user

    {:ok, _ref} =
      Presence.track(socket, "#{user.id}", %{
        name: user.name,
        # Email is deliberately NOT tracked in presence. Peers get
        # `name` + `avatar` + `user_id`; anything more (email for
        # display, role) is fetched on demand through `/team`.
        avatar: user.avatar,
        user_id: user.id,
        company_id: user.company_id,
        current_form: nil,
        online_at: System.system_time(:second)
      })

    push(socket, "presence_state", filter_for_tenant(Presence.list(socket), user.company_id))
    {:noreply, socket}
  end

  # Presence CRDT lives on one `"lobby"` topic that spans every
  # tenant. Intercepts here filter the state (and each subsequent
  # diff) down to peers in the joining socket's company. That means
  # each client's Phoenix.Presence view is scoped, without needing
  # to reshape the topic namespace or update every consumer.
  @impl true
  def handle_out("presence_state", state, socket) do
    cid = socket.assigns.current_user.company_id
    push(socket, "presence_state", filter_for_tenant(state, cid))
    {:noreply, socket}
  end

  @impl true
  def handle_out("presence_diff", %{joins: joins, leaves: leaves}, socket) do
    cid = socket.assigns.current_user.company_id

    push(socket, "presence_diff", %{
      joins: filter_for_tenant(joins, cid),
      leaves: filter_for_tenant(leaves, cid)
    })

    {:noreply, socket}
  end

  @impl true
  def handle_in("meta:update", payload, socket) do
    # Whitelist the fields a client may set so a stale/malicious push
    # can't smuggle arbitrary keys into presence meta.
    #
    # Coerce the client's string key to a KNOWN atom explicitly. Using
    # `String.to_existing_atom/1` here would still be safe against
    # atom-table growth, but that safety only holds so long as the
    # meta contract stays static — one future addition of an atom
    # elsewhere in the app that happens to match a client string
    # would let it through. Explicit whitelist is durable.
    updates = %{
      current_form: sanitise_current_form(Map.get(payload, "current_form"))
    }

    user = socket.assigns.current_user

    Presence.update(socket, "#{user.id}", fn meta ->
      Map.merge(meta, updates)
    end)

    {:noreply, socket}
  end

  def handle_in(_event, _payload, socket), do: {:noreply, socket}

  ## ------------------------------------------------------------------

  # `current_form` is a soft label the top-bar shows peers. Trim to a
  # bounded length so an oversized string can't inflate every peer's
  # presence payload.
  defp sanitise_current_form(nil), do: nil

  defp sanitise_current_form(value) when is_binary(value) do
    value
    |> String.slice(0, 120)
  end

  defp sanitise_current_form(_), do: nil

  # Keep only presence entries whose metas belong to `company_id`.
  # An entry can have multiple metas (one per open tab / device) — a
  # user is same-tenant if ANY of their metas match. In practice a
  # single user's metas always share company_id, but we don't rely
  # on that.
  defp filter_for_tenant(presence_map, company_id) do
    presence_map
    |> Enum.filter(fn {_user_id, %{metas: metas}} ->
      Enum.any?(metas, fn meta -> meta[:company_id] == company_id end)
    end)
    |> Map.new()
  end
end
