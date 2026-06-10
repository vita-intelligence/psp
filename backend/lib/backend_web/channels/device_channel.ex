defmodule BackendWeb.DeviceChannel do
  @moduledoc """
  Per-device channel. Topic shape: `device:<device_uuid>`.

  Only the device itself can join — the socket must have been opened
  with `?device_token=…` and the connected device's uuid must match
  the topic suffix. This stops one device from listening in on
  another device's broadcasts even if a stolen UUID got out.

  Events the channel receives (broadcast from `Backend.Devices`):

    * `ping`    — `%{message, sent_at}` — laptop "send test ping".
    * `revoked` — empty — emitted on revoke; client should disconnect.
  """

  use Phoenix.Channel

  alias Backend.Devices

  @impl true
  def join("device:" <> uuid, _params, socket) do
    case socket.assigns[:current_device] do
      %{uuid: ^uuid} = device ->
        # Touch on join so "online" status is fresh in the settings list.
        Devices.touch(device)
        {:ok, %{device_uuid: uuid}, socket}

      _ ->
        {:error, %{reason: "forbidden"}}
    end
  end

  @impl true
  def handle_in(_event, _payload, socket), do: {:noreply, socket}
end
