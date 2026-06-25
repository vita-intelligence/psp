defmodule BackendWeb.WizardChannel do
  @moduledoc """
  Per-CO wizard channel. Topic shape: `wizard:co:<co_uuid>`.

  Pushes a `:changed` event whenever the BE state behind a project
  control board moves — CO state transitions, MO create / transition
  / finish, PO state changes, Goods-In QC sign-off. The FE listens
  and re-fetches the snapshot on each event so collaborators see each
  other's work without a manual refresh.

  Auth: joiner must hold `customer_orders.view` AND the CO must be
  in the joiner's company. Otherwise `forbidden`.

  Push-only. Clients don't `push` anything in V1 — all wizard writes
  go through the normal REST endpoints (which then trigger the
  broadcast).
  """

  use Phoenix.Channel

  alias Backend.CustomerOrders
  alias Backend.RBAC

  @impl true
  def join("wizard:co:" <> uuid, _params, socket) do
    user = socket.assigns[:current_user]

    cond do
      is_nil(user) ->
        {:error, %{reason: "forbidden"}}

      not RBAC.has_permission?(user, "customer_orders.view") ->
        {:error, %{reason: "forbidden"}}

      true ->
        case CustomerOrders.get_for_company(user.company_id, uuid) do
          nil -> {:error, %{reason: "not_found"}}
          %{} -> {:ok, %{co_uuid: uuid}, socket}
        end
    end
  end

  def join(_topic, _params, _socket), do: {:error, %{reason: "bad_topic"}}

  @impl true
  def handle_in(_event, _payload, socket), do: {:noreply, socket}

  @doc """
  Broadcast a `:changed` event to every subscriber of this CO's
  wizard channel. Called from context modules whenever they touch
  state the wizard projects over.
  """
  def broadcast_changed(co_uuid) when is_binary(co_uuid) do
    BackendWeb.Endpoint.broadcast!(
      "wizard:co:" <> co_uuid,
      "changed",
      %{at: DateTime.utc_now()}
    )
  end

  def broadcast_changed(_), do: :ok
end
