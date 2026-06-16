defmodule BackendWeb.UserChannel do
  @moduledoc """
  Per-user channel. Topic shape: `user:<user_uuid>`.

  Lets the BE push events to every browser tab + paired device the
  authenticated user has open. Used by the phone → laptop print bridge
  (`BackendWeb.PrintBridgeController`) so the operator's wizard can
  trigger a label print on their own laptop without touching anyone
  else's session.

  Auth rule: the joining socket's `current_user.uuid` must match the
  topic suffix. Otherwise return `forbidden` — stops one user from
  subscribing to another user's notification stream even if a uuid
  leaked.
  """

  use Phoenix.Channel

  @impl true
  def join("user:" <> uuid, _params, socket) do
    case socket.assigns[:current_user] do
      %{uuid: ^uuid} ->
        {:ok, %{user_uuid: uuid}, socket}

      _ ->
        {:error, %{reason: "forbidden"}}
    end
  end

  # No client-initiated events at the moment — the channel is push-only.
  @impl true
  def handle_in(_event, _payload, socket), do: {:noreply, socket}
end
