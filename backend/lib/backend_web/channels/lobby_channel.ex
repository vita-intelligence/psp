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
        email: user.email,
        avatar: user.avatar,
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
    allowed = %{
      "current_form" => Map.get(payload, "current_form")
    }

    user = socket.assigns.current_user

    Presence.update(socket, "#{user.id}", fn meta ->
      Map.merge(meta, normalize_keys(allowed))
    end)

    {:noreply, socket}
  end

  def handle_in(_event, _payload, socket), do: {:noreply, socket}

  ## ------------------------------------------------------------------

  defp normalize_keys(map) do
    Enum.into(map, %{}, fn
      {k, v} when is_binary(k) -> {String.to_existing_atom(k), v}
      pair -> pair
    end)
  end
end
