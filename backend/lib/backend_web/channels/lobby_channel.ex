defmodule BackendWeb.LobbyChannel do
  @moduledoc """
  Single "lobby" channel everyone joins on login. Its only job for v1 is
  to track presence so the home screen can show an online-now dot next
  to each user. Future: ping/dot for cross-tab events.
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
        online_at: System.system_time(:second)
      })

    push(socket, "presence_state", Presence.list(socket))
    {:noreply, socket}
  end
end
