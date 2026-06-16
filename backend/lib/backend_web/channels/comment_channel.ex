defmodule BackendWeb.CommentChannel do
  @moduledoc """
  Live comment thread for one entity. Topic shape:

      "comments:<entity_type>:<entity_uuid>"

  Examples: `comments:vendor:abc-uuid`, `comments:purchase_order:def-uuid`,
  `comments:stock_lot:ghi-uuid`.

  This channel is pure broadcast — every write goes through the HTTP
  `CommentsController`, which `Endpoint.broadcast/3`s back onto this
  topic so every open thread sees `comment:created` /
  `comment:updated` / `comment:deleted` events live without polling.

  Events sent **to** the client:

    * `comment:created` — `%{comment: ...}`
    * `comment:updated` — `%{comment: ...}` (edited body or visibility)
    * `comment:deleted` — `%{comment: ...}` (body replaced with marker)
    * `presence_state` / `presence_diff` — standard Phoenix.Presence
      so the UI can show "Alice is reading this discussion".

  Join is gated by the entity's view permission (same convention as
  the audit log) and we additionally check `can_comment_on?/2` to
  decide whether to expose a typing-presence chip later. Read-only
  viewers can still subscribe — they just can't post.
  """

  use Phoenix.Channel

  alias Backend.{Accounts, Comments, Purchasing, RBAC, Stock, Vendors}
  alias BackendWeb.Presence

  @impl true
  def join("comments:" <> rest, _params, socket) do
    # Refresh the user (mirrors form_channel — permissions might have
    # been granted while their socket was open).
    cached = socket.assigns.current_user
    user = Accounts.get_user(cached.id) || cached

    with {:ok, entity_type, entity_uuid} <- parse_topic(rest),
         :ok <- check_view_perm(user, entity_type),
         {:ok, entity_id} <- resolve_entity_id(user, entity_type, entity_uuid) do
      send(self(), :after_join)

      socket =
        socket
        |> assign(:current_user, user)
        |> assign(:entity_type, entity_type)
        |> assign(:entity_uuid, entity_uuid)
        |> assign(:entity_id, entity_id)
        |> assign(:can_comment, Comments.can_comment_on?(user, entity_type))

      {:ok, %{can_comment: socket.assigns.can_comment, user_id: user.id}, socket}
    else
      :error -> {:error, %{reason: "bad_topic"}}
      {:error, :forbidden} -> {:error, %{reason: "forbidden"}}
      {:error, :not_found} -> {:error, %{reason: "not_found"}}
    end
  end

  @impl true
  def handle_info(:after_join, socket) do
    user = socket.assigns.current_user

    {:ok, _ref} =
      Presence.track(socket, "#{user.id}", %{
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        can_comment: socket.assigns.can_comment,
        joined_at: System.system_time(:second)
      })

    push(socket, "presence_state", Presence.list(socket))
    {:noreply, socket}
  end

  # Typing indicator — pure broadcast, no persistence. Lets the UI
  # show "Alice is typing…" without a separate state machine.
  @impl true
  def handle_in("typing:start", _payload, socket) do
    broadcast_from!(socket, "typing:start", %{by: socket.assigns.current_user.id})
    {:noreply, socket}
  end

  @impl true
  def handle_in("typing:stop", _payload, socket) do
    broadcast_from!(socket, "typing:stop", %{by: socket.assigns.current_user.id})
    {:noreply, socket}
  end

  def handle_in(_event, _payload, socket), do: {:noreply, socket}

  ## ------------------------------------------------------------------

  defp parse_topic(rest) do
    case String.split(rest, ":", parts: 2) do
      [entity_type, entity_uuid] when entity_type != "" and entity_uuid != "" ->
        if entity_type in Comments.entity_types(),
          do: {:ok, entity_type, entity_uuid},
          else: :error

      _ ->
        :error
    end
  end

  defp check_view_perm(user, "vendor"),
    do: gate(user, "vendors.view")

  defp check_view_perm(user, "purchase_order"),
    do: gate(user, "procurement.po_view")

  defp check_view_perm(user, "stock_lot"),
    do: gate(user, "stock.view")

  defp check_view_perm(user, "bom"),
    do: gate(user, "production.bom_view")

  defp check_view_perm(user, "workstation_group"),
    do: gate(user, "production.workstation_group_view")

  defp check_view_perm(user, "workstation"),
    do: gate(user, "production.workstation_view")

  defp check_view_perm(_user, _other), do: {:error, :forbidden}

  defp gate(user, code) do
    if RBAC.has_permission?(user, code), do: :ok, else: {:error, :forbidden}
  end

  defp resolve_entity_id(user, "vendor", uuid) do
    case Vendors.get_for_company(user.company_id, uuid) do
      %{id: id} -> {:ok, id}
      _ -> {:error, :not_found}
    end
  end

  defp resolve_entity_id(user, "purchase_order", uuid) do
    case Purchasing.get_for_company(user.company_id, uuid) do
      %{id: id} -> {:ok, id}
      _ -> {:error, :not_found}
    end
  end

  defp resolve_entity_id(user, "stock_lot", uuid) do
    case Stock.get_for_company(user.company_id, uuid) do
      %{id: id} -> {:ok, id}
      _ -> {:error, :not_found}
    end
  end

  defp resolve_entity_id(user, "bom", uuid) do
    case Backend.Production.get(user.company_id, uuid) do
      %{id: id} -> {:ok, id}
      _ -> {:error, :not_found}
    end
  end

  defp resolve_entity_id(user, "workstation_group", uuid) do
    case Backend.Production.get_workstation_group(user.company_id, uuid) do
      %{id: id} -> {:ok, id}
      _ -> {:error, :not_found}
    end
  end

  defp resolve_entity_id(user, "workstation", uuid) do
    case Backend.Production.get_workstation(user.company_id, uuid) do
      %{id: id} -> {:ok, id}
      _ -> {:error, :not_found}
    end
  end

  defp resolve_entity_id(_user, _other, _uuid), do: {:error, :not_found}
end
