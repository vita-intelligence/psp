defmodule BackendWeb.UserSocket do
  @moduledoc """
  WebSocket entry point. Token-authenticated — the client connects to
  `/socket/websocket?token=<bearer>` after login.
  """

  use Phoenix.Socket

  alias Backend.Accounts

  channel "lobby", BackendWeb.LobbyChannel
  channel "form:*", BackendWeb.FormChannel
  channel "plan:warehouse:*", BackendWeb.WarehousePlanChannel

  @impl true
  def connect(%{"token" => token}, socket, _connect_info) do
    case Accounts.verify_token(token) do
      {:ok, %{is_active: true} = user} ->
        {:ok,
         socket
         |> assign(:current_user, user)}

      _ ->
        :error
    end
  end

  def connect(_params, _socket, _connect_info), do: :error

  @impl true
  def id(socket), do: "users_socket:#{socket.assigns.current_user.id}"
end
