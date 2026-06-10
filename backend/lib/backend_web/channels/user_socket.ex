defmodule BackendWeb.UserSocket do
  @moduledoc """
  WebSocket entry point.

  Two auth paths, picked by query param:

    * `?token=<session_token>`        — laptop/web session (Phoenix.Token)
    * `?device_token=<device_token>`  — paired phone/tablet (DB-backed)

  Both resolve to an `:current_user`. The device path also assigns
  `:current_device` so `device:*` channels can verify the joining
  socket actually owns the topic.
  """

  use Phoenix.Socket

  alias Backend.{Accounts, Devices}

  channel "lobby", BackendWeb.LobbyChannel
  channel "form:*", BackendWeb.FormChannel
  channel "plan:warehouse:*", BackendWeb.WarehousePlanChannel
  channel "device:*", BackendWeb.DeviceChannel
  channel "pairing:*", BackendWeb.PairingChannel

  @impl true
  def connect(%{"device_token" => token}, socket, _connect_info) when is_binary(token) do
    case Devices.authenticate_token(token) do
      {:ok, {device, %{is_active: true} = user}} ->
        {:ok,
         socket
         |> assign(:current_user, user)
         |> assign(:current_device, device)}

      _ ->
        :error
    end
  end

  def connect(%{"token" => token}, socket, _connect_info) do
    case Accounts.verify_token(token) do
      {:ok, %{is_active: true} = user} ->
        {:ok, assign(socket, :current_user, user)}

      _ ->
        :error
    end
  end

  def connect(_params, _socket, _connect_info), do: :error

  @impl true
  def id(socket) do
    case socket.assigns do
      %{current_device: device} -> "devices_socket:#{device.id}"
      %{current_user: user} -> "users_socket:#{user.id}"
    end
  end
end
