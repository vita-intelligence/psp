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

  alias Backend.{Accounts, RBAC}
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
    # Re-read the user from DB at join time. The socket-assigned
    # `current_user` is the snapshot from connect (login), so any
    # permission an admin granted while this user already had a
    # socket open wouldn't be visible otherwise — and the form's
    # `can_edit_resource?/2` gate would 403 a user who'd been
    # rightfully promoted minutes earlier.
    cached = socket.assigns.current_user
    user = Accounts.get_user(cached.id) || cached
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

            socket =
              socket
              |> assign(:current_user, user)
              |> assign(:form_resource, resource)

            {:ok, %{limit: limit, user_id: user.id}, socket}
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

  # The creator hit Save / Create successfully — fan-out the event so
  # every other editor can react (navigate to the new resource on
  # create, reset local "dirty" state and show a toast on save). The
  # payload is consumer-defined; we just rebroadcast.
  @impl true
  def handle_in("form:committed", payload, socket) do
    broadcast_from!(socket, "form:committed", %{
      by: socket.assigns.current_user.id,
      payload: payload
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

  # Per-user matrix editor (admin toggle + permissions array + wage).
  defp can_edit_resource?(user, "user-access"),
    do: RBAC.has_permission?(user, "roles.edit")

  # Permission-template editor (create/edit on /settings/roles).
  # Either roles.edit OR roles.create lets you collaborate on a draft;
  # the HTTP save layer enforces the right gate per action.
  defp can_edit_resource?(user, "role"),
    do: RBAC.has_permission?(user, "roles.edit") or
        RBAC.has_permission?(user, "roles.create")

  # Units-of-measurement editor. units.manage gates both new + edit;
  # there's no separate create/edit split because the matrix uses one
  # code for both.
  defp can_edit_resource?(user, "unit-of-measurement"),
    do: RBAC.has_permission?(user, "units.manage")

  # Stock items — split between create + edit so a draft form can
  # accept either role for collab.
  defp can_edit_resource?(user, "item"),
    do:
      RBAC.has_permission?(user, "items.edit") or
        RBAC.has_permission?(user, "items.create")

  defp can_edit_resource?(user, "product-family"),
    do: RBAC.has_permission?(user, "product_families.manage")

  defp can_edit_resource?(user, "attribute-definition"),
    do: RBAC.has_permission?(user, "attribute_definitions.manage")

  defp can_edit_resource?(user, "certificate"),
    do: RBAC.has_permission?(user, "certificates.manage")

  # Procurement — vendors and purchase orders. Either create OR edit
  # lets you join a draft; HTTP gates each save action itself.
  defp can_edit_resource?(user, "vendor"),
    do:
      RBAC.has_permission?(user, "vendors.edit") or
        RBAC.has_permission?(user, "vendors.create")

  defp can_edit_resource?(user, "purchase-order"),
    do: RBAC.has_permission?(user, "procurement.po_create")

  # AP-ledger invoice form — gated by the manage permission (same gate
  # the HTTP create / update / delete actions enforce). Topic shape is
  # `form:invoice:<po_uuid>:new` on create and `form:invoice:<uuid>`
  # on edit; `parse_topic/1` accepts either.
  defp can_edit_resource?(user, "invoice"),
    do: RBAC.has_permission?(user, "procurement.invoice_manage")

  # PO receive dialog — multiple operators can collaborate on a single
  # receive event (one reading off the BOL, one keying pack qtys). The
  # head-of-room gate prevents simultaneous submits from racing.
  defp can_edit_resource?(user, "po-receive"),
    do: RBAC.has_permission?(user, "procurement.po_receive")

  # Stock — lot identity + packaging edit form. `stock.receive` covers
  # the create flow (/stock/lots/new); `stock.edit` covers the per-lot
  # edit page. Either lets you join the room.
  defp can_edit_resource?(user, "stock-lot"),
    do:
      RBAC.has_permission?(user, "stock.edit") or
        RBAC.has_permission?(user, "stock.receive")

  # Warehouse plan editor — storage cells / levels CRUD inside a rack.
  # Same gate as the warehouse itself; multiple planners may stack the
  # levels together. Room limit stays at the default 10 — if the plan
  # editor ever needs more concurrent hands, bump via `room_limit_for/1`.
  defp can_edit_resource?(user, "warehouse-cells"),
    do: RBAC.has_permission?(user, "warehouses.edit")

  # Storage tag vocabulary editor.
  defp can_edit_resource?(user, "storage-tag"),
    do: RBAC.has_permission?(user, "storage_tags.manage")

  # Workstation group form — clusters of identical workstations
  # (oven banks, packaging lines). Create or edit both qualify;
  # the head-of-room gate prevents collision on save.
  defp can_edit_resource?(user, "workstation-group"),
    do:
      RBAC.has_permission?(user, "production.workstation_group_edit") or
        RBAC.has_permission?(user, "production.workstation_group_create")

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
