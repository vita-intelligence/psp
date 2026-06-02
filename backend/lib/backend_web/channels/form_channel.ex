defmodule BackendWeb.FormChannel do
  @moduledoc """
  Generic live-form collaboration. One channel per editable resource:

      "form:warehouse:42"   — editing warehouse 42
      "form:warehouse:new"  — drafting a new warehouse
      "form:company:1"      — editing the company singleton

  Events sent **from** the client:

    * `field:change`     — `%{field, value, ts}`. Pure broadcast, no
                           persistence — the DB is hit by HTTP on Save.
    * `field:focus`      — `%{field}`. Triggers a presence meta update
                           so peers can see who's in which field.
    * `field:blur`       — `%{field}`. Clears the focused field on
                           that peer's presence meta.
    * `snapshot:request` — sent on first join; peers respond with
                           their current local form state so the
                           late joiner catches up.

  Events sent **to** the client:

    * `field:change`     — same shape as inbound, rebroadcast.
    * `presence_state` / `presence_diff` — standard Phoenix.Presence.
    * `snapshot:response` — `%{state}` from a peer responding to a
                            joiner's request.

  Persistence: this channel is pure sync between concurrent editors.
  The HTTP layer (PUT /api/warehouses/:id, etc.) is the only place the
  DB gets touched.
  """

  use Phoenix.Channel

  alias Backend.RBAC
  alias BackendWeb.Presence

  # Soft cap on concurrent editors per form. Picked to keep the
  # field-editing-avatar UI legible (more than ~10 in a single form is
  # operationally chaotic). Tweak per-resource via `room_limit_for/1`
  # if a future use case (e.g. plan editor) wants a bigger room.
  # **Keep in sync** with `MAX_COLLABORATORS` in the frontend
  # `use-live-form.tsx`.
  @default_room_limit 10

  @impl true
  def join("form:" <> rest, _params, socket) do
    user = socket.assigns.current_user
    topic = "form:" <> rest

    case parse_topic(rest) do
      {:ok, resource, _id} ->
        limit = room_limit_for(resource)

        cond do
          not can_edit_resource?(user, resource) ->
            {:error, %{reason: "forbidden"}}

          room_full?(user, topic, limit) ->
            {:error, %{reason: "form_full", limit: limit}}

          true ->
            send(self(), :after_join)
            {:ok, %{limit: limit, user_id: user.id}, assign(socket, :form_resource, resource)}
        end

      :error ->
        {:error, %{reason: "bad_topic"}}
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
        focus_field: nil,
        joined_at: System.system_time(:second)
      })

    push(socket, "presence_state", Presence.list(socket))
    {:noreply, socket}
  end

  @impl true
  def handle_in("field:change", %{"field" => field, "value" => value} = payload, socket) do
    broadcast_from!(socket, "field:change", %{
      field: field,
      value: value,
      ts: payload["ts"] || System.system_time(:millisecond),
      by: socket.assigns.current_user.id
    })

    {:noreply, socket}
  end

  @impl true
  def handle_in("field:focus", %{"field" => field}, socket) do
    update_focus(socket, field)
    {:noreply, socket}
  end

  @impl true
  def handle_in("field:blur", %{"field" => _field}, socket) do
    update_focus(socket, nil)
    {:noreply, socket}
  end

  @impl true
  def handle_in("snapshot:request", _payload, socket) do
    # Broadcast a request to peers; the first peer to respond replies
    # with their local snapshot. We don't dedupe in dev — small teams
    # mean ≤3 peers respond, and the joining client picks the first.
    broadcast_from!(socket, "snapshot:request", %{
      by: socket.assigns.current_user.id
    })

    {:noreply, socket}
  end

  @impl true
  def handle_in("snapshot:response", %{"state" => state, "to" => to}, socket) do
    broadcast_from!(socket, "snapshot:response", %{
      state: state,
      to: to,
      by: socket.assigns.current_user.id
    })

    {:noreply, socket}
  end

  # Live cursor — `x` and `y` are normalized 0..1 fractions of the
  # anchor element's width / height. Sender + receiver agree on the
  # anchor (the form Card) so layouts at different sizes still line up.
  # Pure broadcast — no persistence, no presence meta. Cursor disappears
  # on `cursor:hide` or when the user leaves the channel.
  @impl true
  def handle_in("cursor:move", %{"x" => x, "y" => y}, socket)
      when is_number(x) and is_number(y) do
    broadcast_from!(socket, "cursor:move", %{
      by: socket.assigns.current_user.id,
      x: x,
      y: y
    })

    {:noreply, socket}
  end

  @impl true
  def handle_in("cursor:hide", _payload, socket) do
    broadcast_from!(socket, "cursor:hide", %{
      by: socket.assigns.current_user.id
    })

    {:noreply, socket}
  end

  def handle_in(_event, _payload, socket), do: {:noreply, socket}

  ## ------------------------------------------------------------------

  defp update_focus(socket, field) do
    user = socket.assigns.current_user

    Presence.update(socket, "#{user.id}", fn meta ->
      %{meta | focus_field: field}
    end)
  end

  # Topics look like `form:<resource>:<id>` where id can be an int or
  # the literal "new". Reject anything else so we don't accept random
  # strings.
  defp parse_topic(rest) do
    case String.split(rest, ":", parts: 2) do
      [resource, id] when resource != "" and id != "" ->
        {:ok, resource, id}

      _ ->
        :error
    end
  end

  # For now every form-collab channel just requires the same permission
  # as the HTTP edit endpoint for that resource. Add resources here as
  # we ship more collaborative forms.
  defp can_edit_resource?(user, "warehouse"),
    do: RBAC.has_permission?(user, "warehouses.edit") or
        RBAC.has_permission?(user, "warehouses.create")

  defp can_edit_resource?(user, "company"),
    do: RBAC.has_permission?(user, "company.edit")

  defp can_edit_resource?(_user, _resource), do: false

  # Per-resource override for the room cap. Default to
  # @default_room_limit. Override if a specific form needs a larger
  # ceiling (e.g. the future plan editor with many viewers).
  defp room_limit_for(_resource), do: @default_room_limit

  # The user already being in another tab counts as one slot but doesn't
  # take another — we identify by user id, not socket pid. Reject only
  # when the room is full AND the joining user isn't already represented.
  defp room_full?(user, topic, limit) do
    state = Presence.list(topic)
    distinct_users = map_size(state)
    already_in = Map.has_key?(state, to_string(user.id))

    distinct_users >= limit and not already_in
  end
end
