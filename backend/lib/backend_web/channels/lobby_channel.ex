defmodule BackendWeb.LobbyChannel do
  @moduledoc """
  Per-tenant "who's online" channel. Every user in a company shares
  one Presence CRDT via the sharded topic `lobby:<company_id>`;
  cross-tenant broadcasts don't exist because the topic namespace is
  disjoint.

  Tracks who's online (drives the avatar dot on the home screen and
  the connection pill in the top bar) AND which form a user is
  currently focused on, so the list views can show "Alice is editing
  London HQ" indicators without every list needing its own presence
  subscription.

  The `current_form` field is `"<resource>:<id>"` or `nil`. Pushed via
  the `meta:update` event from the client when they navigate onto a
  form route or leave it.

  Previously the topic was a single `"lobby"` string and a per-socket
  `intercept + handle_out` filter dropped foreign-tenant peers before
  push. That's O(N·n) per diff (every socket re-scanned the full
  roster). Per-tenant topics collapse it to O(n) per diff, delivered
  only to that tenant's subscribers.
  """

  use Phoenix.Channel

  alias BackendWeb.Presence

  @impl true
  def join("lobby:" <> company_id_str, _params, socket) do
    user = socket.assigns.current_user

    with {cid, ""} <- Integer.parse(company_id_str),
         true <- cid == user.company_id do
      send(self(), :after_join)
      {:ok, socket}
    else
      _ -> {:error, %{reason: "forbidden"}}
    end
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
        current_form: nil,
        online_at: System.system_time(:second)
      })

    push(socket, "presence_state", Presence.list(socket))
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
end
