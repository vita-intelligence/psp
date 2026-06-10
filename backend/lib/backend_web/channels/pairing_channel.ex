defmodule BackendWeb.PairingChannel do
  @moduledoc """
  Short-lived channel the laptop "Pair new device" dialog subscribes
  to so it can auto-close when the phone claims the code. Topic shape:
  `pairing:<pairing_uuid>`.

  Authenticated by the session user — only the user who created the
  pairing code may listen. The mobile device side does NOT join this
  channel; it just POSTs to /api/devices/claim, and Phoenix broadcasts
  the `claimed` event on its behalf from `Backend.Devices.claim_pairing_code/1`.

  Events broadcast to subscribers:

    * `claimed` — `%{device_uuid, label}` once the phone claims.
  """

  use Phoenix.Channel

  alias Backend.Devices

  @impl true
  def join("pairing:" <> uuid, _params, socket) do
    user = socket.assigns[:current_user]

    case Devices.lookup_pairing_code_by_uuid(uuid) do
      {:ok, %{user_id: user_id}} when user != nil and user.id == user_id ->
        {:ok, %{pairing_uuid: uuid}, socket}

      _ ->
        {:error, %{reason: "forbidden"}}
    end
  end

  @impl true
  def handle_in(_event, _payload, socket), do: {:noreply, socket}
end
