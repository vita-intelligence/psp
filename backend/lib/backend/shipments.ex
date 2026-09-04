defmodule Backend.Shipments do
  @moduledoc """
  Outbound-shipment lifecycle — BRCGS Issue 9 § 5.4.6 receipt trail.
  Every real world shipment (one truck, one lot for MVP) gets a row
  and follows draft → ready → picked_up.

  Flow, top-to-bottom:

    * `create_from_lot/2` — desktop or mobile-scan entry point. Lot
      must currently sit in a `dispatch` cell (that's the whole point
      of the record: it's paperwork for the goods already staged).
      Customer + customer_order snapshot from bailee custody or the
      MO chain. Row lands in `draft`.
    * `update/3` — desktop form edits. Any field except lifecycle
      stamps. Only allowed on `draft` / `ready`.
    * `mark_ready/2` — checks the BRCGS-mandatory fields are filled
      + flips status.
    * `mark_draft/2` — inverse of ready when the operator spots
      something missing.
    * `confirm_pickup/2` — placeholder for the truck-arrival flow;
      today it just stamps status = picked_up + picked_up_by.
    * `cancel/3` — draft or ready to cancelled, records a reason.
  """

  import Ecto.Query

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.CustomerOrders.CustomerOrderLine
  alias Backend.Customers.Customer
  alias Backend.Production.ManufacturingOrder
  alias Backend.RBAC
  alias Backend.Repo
  alias Backend.Shipments.{
    Shipment,
    ShipmentPickupEvent,
    ShipmentPickupFile,
    ShipmentDeliveryFile
  }
  alias Backend.Stock.{Lot, Movement, Placement}
  alias Backend.Warehouses.StorageCell

  # Three perms for three personas: view (broad audience — sales,
  # finance, customer service, warehouse manager), edit (shipping
  # coordinator filling paperwork + mark_ready / mark_draft / cancel),
  # and pickup (physical truck-arrival confirmation).
  @perm_edit "shipments.edit"
  @perm_pickup "shipments.pickup"
  @perm_confirm_delivery "shipments.confirm_delivery"

  # ==================================================================
  # Creation
  # ==================================================================

  @doc """
  Create a `draft` shipment against `lot_uuid`. Enforces:

    * actor holds `production.final_release`
    * lot has an active placement in a `dispatch` cell (that's what
      the scan was verifying — the shipment paperwork exists because
      the goods are already in shipping)
    * no other open shipment already covers this lot (draft or ready)

  Returns `{:ok, %Shipment{}}` or `{:error, reason}` — `:forbidden`,
  `:lot_not_found`, `:lot_not_in_dispatch`, `:already_open`, or a
  `%Ecto.Changeset{}`.
  """
  def create_from_lot(%User{} = actor, lot_uuid, opts \\ [])
      when is_binary(lot_uuid) and is_list(opts) do
    with :ok <- ensure_edit(actor),
         {:ok, lot} <- fetch_lot(actor.company_id, lot_uuid),
         {:ok, resolved_qty} <- resolve_shipment_qty(lot, opts),
         :ok <- ensure_no_open_shipment(lot) do
      customer_id = derive_customer_id(lot)
      customer_order_id = derive_customer_order_id(lot)
      customer_order_line_id = derive_customer_order_line_id(lot)
      prefill = derive_prefill_attrs(customer_id, customer_order_id)

      # Cap the shipment qty at the reservation qty when the lot has
      # been earmarked to a CO line at closeout time. This is what
      # keeps a 11k-produced lot with a 10k CO ordered from
      # accidentally shipping the whole thing — the extra 1k stays
      # in the free cell as unreserved surplus.
      qty = cap_qty_against_reservation(lot.id, customer_order_line_id, resolved_qty)

      base_attrs = %{
        company_id: actor.company_id,
        stock_lot_id: lot.id,
        customer_id: customer_id,
        customer_order_id: customer_order_id,
        qty: qty,
        created_by_id: actor.id,
        status: "draft"
      }

      %Shipment{}
      |> Shipment.create_changeset(Map.merge(base_attrs, prefill))
      |> Repo.insert()
      |> tap_audit_created(actor)
    end
  end

  # Callers with a specific in-hand qty (bailee 3PL dispatches carry
  # the customer's request qty on the ``Dispatch`` row) pass
  # ``:qty`` explicitly — that overrides the dispatch-cell placement
  # lookup. Without this override the placement total is used, which
  # is wrong when the dispatch cell still holds leftover units from
  # a prior fully-picked-up shipment (the pickup event doesn't
  # currently decrement dispatch-cell placements). Direct-ship flow
  # keeps the placement-derived default by not passing ``:qty``.
  defp resolve_shipment_qty(lot, opts) do
    case Keyword.get(opts, :qty) do
      %Decimal{} = qty ->
        if Decimal.compare(qty, Decimal.new(0)) == :gt do
          {:ok, qty}
        else
          {:error, :bad_qty}
        end

      _ ->
        find_dispatch_placement_qty(lot)
    end
  end

  defp cap_qty_against_reservation(_lot_id, nil, dispatch_qty), do: dispatch_qty

  defp cap_qty_against_reservation(lot_id, line_id, dispatch_qty) do
    reserved = Backend.CustomerOrders.reserved_qty_for(lot_id, line_id)

    cond do
      Decimal.compare(reserved, 0) == :eq ->
        dispatch_qty

      Decimal.compare(reserved, dispatch_qty) == :lt ->
        reserved

      true ->
        dispatch_qty
    end
  end

  # Look up the customer + linked customer order and turn them into
  # sensible defaults for the fresh draft. The operator can still
  # overwrite any of these via the desktop form before marking Ready —
  # this is purely a "don't retype the same address the sales team
  # already captured on NPD" shortcut. Silently degrades to no
  # prefill when the linked rows can't be resolved (nil ids, deleted
  # rows) so an odd corner case doesn't block shipment creation.
  defp derive_prefill_attrs(customer_id, customer_order_id) do
    co =
      case customer_order_id do
        id when is_integer(id) ->
          Repo.get(Backend.CustomerOrders.CustomerOrder, id)

        _ ->
          nil
      end

    customer =
      case customer_id do
        id when is_integer(id) -> Repo.get(Customer, id)
        _ -> nil
      end

    # Address: prefer the CO's per-order ``delivery_address`` (that's
    # what the customer typed into the website order form), fall back
    # to the customer's legal address for accounts that skipped it.
    address =
      cond do
        co && present?(co.delivery_address) -> co.delivery_address
        customer && present?(customer.legal_address) -> customer.legal_address
        true -> nil
      end

    recipient =
      cond do
        customer && present?(customer.contact_name) -> customer.contact_name
        customer && present?(customer.name) -> customer.name
        true -> nil
      end

    country =
      cond do
        customer && present?(customer.country_code) ->
          String.upcase(customer.country_code)

        true ->
          nil
      end

    # CO's ``expected_ship_date`` is a plain Date; the shipment column
    # is a UTC datetime. Anchor to noon UTC on that date so a UK
    # user's local-time picker doesn't render "yesterday" in a
    # tzinfo-aware calendar. Operator picks the exact departure time
    # in the form.
    planned_ship_at =
      case co && co.expected_ship_date do
        %Date{} = d ->
          {:ok, dt} = DateTime.new(d, ~T[12:00:00], "Etc/UTC")
          DateTime.truncate(dt, :second)

        _ ->
          nil
      end

    %{
      recipient_name: recipient,
      ship_to_address: address,
      ship_to_country: country,
      planned_ship_at: planned_ship_at
    }
    |> Enum.reject(fn {_k, v} -> is_nil(v) end)
    |> Map.new()
  end

  defp present?(v) when is_binary(v), do: byte_size(String.trim(v)) > 0
  defp present?(_), do: false

  defp tap_audit_created({:ok, %Shipment{} = row}, actor) do
    Audit.record_created(actor, "shipment", row, shipment_snapshot(row))
    Backend.Broadcasts.entity_changed("shipment", row.uuid, row.company_id, "created")
    {:ok, row}
  end

  defp tap_audit_created(other, _actor), do: other

  defp tap_audit_updated(res, actor, before_state),
    do: tap_audit_updated(res, actor, before_state, "updated")

  defp tap_audit_updated({:ok, %Shipment{} = row}, actor, before_state, action) do
    Audit.record_updated(
      actor,
      "shipment",
      row,
      before_state,
      shipment_snapshot(row)
    )

    Backend.Broadcasts.entity_changed("shipment", row.uuid, row.company_id, action)
    {:ok, row}
  end

  defp tap_audit_updated(other, _actor, _before, _action), do: other

  # Snapshot used by the audit log's before / after diff. Keep in
  # sync with @editable_fields + the lifecycle columns so field-level
  # changes render meaningfully on the history rail.
  defp shipment_snapshot(%Shipment{} = row) do
    %{
      status: row.status,
      qty: row.qty,
      customer_id: row.customer_id,
      customer_order_id: row.customer_order_id,
      recipient_name: row.recipient_name,
      ship_to_address: row.ship_to_address,
      ship_to_country: row.ship_to_country,
      carrier: row.carrier,
      vehicle_registration: row.vehicle_registration,
      driver_name: row.driver_name,
      consignment_note_ref: row.consignment_note_ref,
      seal_number: row.seal_number,
      temperature_c: row.temperature_c,
      planned_ship_at: row.planned_ship_at,
      notes: row.notes,
      loading_photo_url: row.loading_photo_url,
      ready_at: row.ready_at,
      ready_by_id: row.ready_by_id,
      picked_up_at: row.picked_up_at,
      picked_up_by_id: row.picked_up_by_id,
      cancelled_at: row.cancelled_at,
      cancelled_by_id: row.cancelled_by_id,
      cancel_reason: row.cancel_reason
    }
  end

  # ==================================================================
  # Updates
  # ==================================================================

  @doc """
  Edit fields on a draft or ready shipment.

  When the shipment's lot is own-stock (not 3PL / bailee), we coerce
  `qty` back to the lot's full dispatch-placement quantity — own-stock
  ships whole. Splitting your own inventory across multiple shipments
  breaks traceability and doubles handling; the 3PL flow is the only
  place partial dispatches are legal because the lot is customer-
  owned and the customer explicitly requests the split.
  """
  def update(%User{} = actor, %Shipment{} = shipment, attrs) do
    with :ok <- ensure_edit(actor),
         :ok <- ensure_editable(shipment) do
      before_state = shipment_snapshot(shipment)
      normalised = normalise_qty_for_ownership(shipment, attrs)

      shipment
      |> Shipment.update_changeset(normalised)
      |> Repo.update()
      |> tap_audit_updated(actor, before_state)
    end
  end

  @doc """
  Post-pickup tracking-number edit. Distinct from :func:`update/3`
  because a carrier's parcel-tracking reference is frequently issued
  AFTER the truck departs, and the desk needs to be able to attach
  it once it lands — long after :func:`ensure_editable/1` has closed
  the general edit gate at ``picked_up``. Cancelled shipments stay
  locked (no point tracking a shipment that never left).

  Body: ``%{"tracking_number" => "AB123456"}`` (or empty string to
  clear). Length capped at 120 chars via ``update_changeset``.

  Broadcasts + audits like a regular edit so the shipment card + the
  portal Dispatch card both refresh live.
  """
  def update_tracking_number(%User{} = actor, %Shipment{} = shipment, tracking_number)
      when is_binary(tracking_number) or is_nil(tracking_number) do
    with :ok <- ensure_edit(actor),
         :ok <- ensure_tracking_editable(shipment) do
      before_state = shipment_snapshot(shipment)
      cleaned = tracking_number |> to_string() |> String.trim()
      value = if cleaned == "", do: nil, else: cleaned

      shipment
      |> Shipment.update_changeset(%{"tracking_number" => value})
      |> Repo.update()
      |> tap_audit_updated(actor, before_state)
    end
  end

  defp ensure_tracking_editable(%Shipment{status: s})
       when s in ~w(draft ready picked_up delivered),
       do: :ok

  defp ensure_tracking_editable(_), do: {:error, :not_editable}

  @doc """
  Post-pickup-safe carrier paperwork edits. Accepts the field subset
  on :func:`Backend.Shipments.Shipment.carrier_details_changeset/2`
  (carrier / vehicle_registration / driver_name /
  consignment_note_ref / tracking_number / seal_number /
  temperature_c). Kept distinct from :func:`update/3` because carrier
  paperwork routinely needs corrections after the truck has left
  (typos on the plate, driver swap, tracking number issued late) —
  the general edit gate stops accepting edits at ``picked_up`` to
  protect ship-to + qty integrity, but the paperwork subset stays
  editable through ``picked_up``.

  Permission gate depends on lifecycle stage:

    * ``draft`` / ``ready`` → requires ``shipments.edit``
    * ``picked_up`` → requires ``shipments.pickup`` (only operators
      who work the dispatch flow should be correcting a truck-
      arrival record)
    * ``delivered`` / ``cancelled`` → refused (:not_editable)
  """
  def update_carrier_details(%User{} = actor, %Shipment{} = shipment, attrs) do
    with :ok <- ensure_carrier_perm(actor, shipment),
         :ok <- ensure_carrier_editable(shipment) do
      before_state = shipment_snapshot(shipment)

      shipment
      |> Shipment.carrier_details_changeset(attrs)
      |> Repo.update()
      |> tap_audit_updated(actor, before_state)
    end
  end

  defp ensure_carrier_perm(actor, %Shipment{status: s}) when s in ~w(draft ready),
    do: ensure_edit(actor)

  defp ensure_carrier_perm(actor, %Shipment{status: s})
       when s in ~w(partially_picked picked_up delivered),
       do: ensure_pickup(actor)

  defp ensure_carrier_perm(_actor, _shipment), do: {:error, :forbidden}

  defp ensure_carrier_editable(%Shipment{status: s})
       when s in ~w(draft ready partially_picked picked_up delivered),
       do: :ok

  defp ensure_carrier_editable(_), do: {:error, :not_editable}

  # For own-stock lots, replace whatever qty the caller sent with the
  # full quantity currently sitting in the dispatch cell. Bailee (3PL)
  # lots pass through untouched — partial dispatches are the whole
  # point of that flow.
  defp normalise_qty_for_ownership(%Shipment{stock_lot_id: nil}, attrs), do: attrs

  defp normalise_qty_for_ownership(%Shipment{stock_lot_id: lot_id}, attrs) do
    case Repo.get(Lot, lot_id) do
      %Lot{ownership_kind: "bailee"} ->
        attrs

      %Lot{} = lot ->
        lot = Repo.preload(lot, placements: [storage_cell: []])

        case find_dispatch_placement_qty(lot) do
          {:ok, full_qty} ->
            attrs
            |> stringify_key("qty")
            |> Map.put("qty", full_qty)

          _ ->
            attrs
        end

      nil ->
        attrs
    end
  end

  # Ecto casts accept both atom and string keys. `Map.put("qty", ...)`
  # would silently coexist with an incoming `:qty` atom key; normalise
  # first so the coerced value wins on cast.
  defp stringify_key(attrs, key) when is_map(attrs) do
    atom_key = String.to_existing_atom(key)

    case Map.pop(attrs, atom_key) do
      {nil, rest} -> rest
      {_val, rest} -> rest
    end
  rescue
    ArgumentError -> attrs
  end

  @doc "Draft → ready. Required paperwork fields must be filled."
  def mark_ready(%User{} = actor, %Shipment{} = shipment) do
    with :ok <- ensure_edit(actor),
         :ok <- ensure_status(shipment, "draft") do
      before_state = shipment_snapshot(shipment)

      shipment
      |> Shipment.ready_changeset(%{
        ready_at: DateTime.utc_now() |> DateTime.truncate(:second),
        ready_by_id: actor.id
      })
      |> Repo.update()
      |> tap_audit_updated(actor, before_state, "marked_ready")
    end
  end

  @doc "Ready → draft. Reopens editing when the desktop team spots " <>
         "something missing before the truck arrives."
  def mark_draft(%User{} = actor, %Shipment{} = shipment) do
    with :ok <- ensure_edit(actor),
         :ok <- ensure_status(shipment, "ready") do
      before_state = shipment_snapshot(shipment)

      shipment
      |> Shipment.unready_changeset()
      |> Repo.update()
      |> tap_audit_updated(actor, before_state, "marked_draft")
    end
  end

  @doc """
  Log one truck arrival. Replaces the old "confirm the whole
  shipment in one shot" model — a shipment now accumulates a list
  of pickup events and auto-transitions between ``ready`` /
  ``partially_picked`` / ``picked_up`` as the events drain the qty.

  ``attrs`` shape (string OR atom keys):

      %{
        "qty" => "3000",           # required, > 0, ≤ remaining_qty
        "driver_name" => "...",
        "vehicle_registration" => "...",
        "consignment_note_ref" => "...",
        "notes" => "...",
        "packaging_intact" => true,
        "labels_verified" => true,
        "vehicle_clean_suitable" => true,
        "transport_condition_acceptable" => true,
        "dispatch_approved" => true,
        # Photos uploaded to the shipment prior to this call get
        # attached to the event atomically. Every log_event needs
        # at least one photo — BRCGS § 5.4.6 visual record.
        "pickup_file_ids" => ["uuid1", "uuid2"]
      }

  Returns ``{:ok, {shipment, event}}`` on success or a discriminated
  error tuple the FE / mobile can render verbatim.
  """
  def log_pickup_event(%User{} = actor, %Shipment{} = shipment, attrs \\ %{}) do
    with :ok <- ensure_pickup(actor),
         :ok <- ensure_status(shipment, ["ready", "partially_picked"]),
         attrs <- normalise_event_attrs(actor, shipment, attrs),
         {:ok, qty} <- parse_positive_decimal(attrs["qty"], :qty),
         :ok <- ensure_qty_within_remaining(shipment, qty),
         {:ok, file_ids} <- resolve_pickup_file_ids(shipment, attrs["pickup_file_ids"]),
         :ok <- ensure_photo_count(file_ids) do
      before_state = shipment_snapshot(shipment)

      Repo.transaction(fn ->
        with {:ok, event} <- insert_pickup_event(actor, shipment, attrs, qty),
             :ok <- attach_files_to_event(shipment, event, file_ids),
             {:ok, updated} <-
               refresh_shipment_after_event(actor, shipment, event, qty, attrs) do
          {updated, event}
        else
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
      |> case do
        {:ok, {updated, event}} ->
          # Audit the shipment state transition. The event row itself
          # gets its own Audit.record_created below so both the
          # per-visit trail + the shipment-level state machine end
          # up on the auditor's rail.
          Audit.record_updated(
            actor,
            "shipment",
            updated,
            before_state,
            shipment_snapshot(updated)
          )

          Audit.record_created(actor, "shipment_pickup_event", event, event_audit_snapshot(event))

          Backend.Broadcasts.entity_changed(
            "shipment",
            updated.uuid,
            updated.company_id,
            "pickup_event_logged"
          )

          {:ok, {updated, event}}

        err ->
          err
      end
    end
  end

  @doc """
  Legacy shim — kept as ``confirm_pickup`` for the mobile / API
  callers that historically flipped ``ready → picked_up`` in one
  shot. Delegates to :func:`log_pickup_event/3` with ``qty =
  remaining_qty`` and pulls every un-linked photo on the shipment
  into the new event. No behavioural change for callers that
  really do want the "single visit takes everything" flow.
  """
  def confirm_pickup(%User{} = actor, %Shipment{} = shipment, attrs \\ %{}) do
    remaining = remaining_qty(shipment)
    orphan_files = pickup_files_without_event(shipment)

    attrs =
      attrs
      |> normalise_map_keys()
      |> Map.put("qty", Decimal.to_string(remaining))
      |> Map.put_new("pickup_file_ids", Enum.map(orphan_files, & &1.uuid))

    log_pickup_event(actor, shipment, attrs)
    |> case do
      {:ok, {updated, _event}} -> {:ok, updated}
      err -> err
    end
  end

  @doc """
  Remaining qty = shipment.qty − sum(pickup_events.qty). Zero when
  every event has drained the shipment. Callers use this to render
  progress bars and default the "qty for this visit" input.
  """
  def remaining_qty(%Shipment{id: id, qty: qty}) do
    picked =
      Repo.one(
        from(e in ShipmentPickupEvent,
          where: e.shipment_id == ^id,
          select: coalesce(sum(e.qty), 0)
        )
      ) || Decimal.new(0)

    total = qty || Decimal.new(0)
    remaining = Decimal.sub(total, picked)

    if Decimal.compare(remaining, Decimal.new(0)) == :lt do
      # Should never happen (server-side validation clamps at
      # insert time), but be defensive so we never emit a negative
      # remaining on the wire.
      Decimal.new(0)
    else
      remaining
    end
  end

  @doc """
  Sum of every pickup event qty for the shipment — companion to
  ``remaining_qty/1`` for the FE progress bar.
  """
  def picked_up_qty(%Shipment{id: id}) do
    Repo.one(
      from(e in ShipmentPickupEvent,
        where: e.shipment_id == ^id,
        select: coalesce(sum(e.qty), 0)
      )
    ) || Decimal.new(0)
  end

  @doc """
  Ordered list of pickup events for a shipment, preloaded with
  their photos + the actor who logged them. Feeds both the PSP
  detail page timeline + the customer portal dispatch card list.
  """
  def list_pickup_events(%Shipment{id: id}) do
    Repo.all(
      from(e in ShipmentPickupEvent,
        where: e.shipment_id == ^id,
        order_by: [asc: e.picked_up_at, asc: e.id],
        preload: [:picked_up_by, :delivered_by, :photos, :delivery_files]
      )
    )
  end

  @doc """
  Fetch a single pickup event by shipment id + event uuid. Returns
  ``nil`` when the event doesn't belong to the shipment (belt +
  braces against a spoofed event uuid on the confirm-delivery path).
  """
  def get_pickup_event(shipment_id, event_uuid)
      when is_integer(shipment_id) and is_binary(event_uuid) do
    Repo.one(
      from(e in ShipmentPickupEvent,
        where: e.shipment_id == ^shipment_id and e.uuid == ^event_uuid,
        preload: [:picked_up_by, :delivered_by, :photos, :delivery_files]
      )
    )
  end

  # ─── Pickup event internals ──────────────────────────────────────

  defp insert_pickup_event(actor, shipment, attrs, qty) do
    event_attrs = %{
      "company_id" => shipment.company_id,
      "shipment_id" => shipment.id,
      "qty" => qty,
      "picked_up_at" => attrs["picked_up_at"],
      "picked_up_by_id" => actor.id,
      "driver_name" => attrs["driver_name"],
      "vehicle_registration" => attrs["vehicle_registration"],
      "consignment_note_ref" => attrs["consignment_note_ref"],
      "tracking_number" => attrs["tracking_number"],
      "seal_number" => attrs["seal_number"],
      "temperature_c" => attrs["temperature_c"],
      "notes" => attrs["notes"],
      "packaging_intact" => attrs["packaging_intact"],
      "labels_verified" => attrs["labels_verified"],
      "vehicle_clean_suitable" => attrs["vehicle_clean_suitable"],
      "transport_condition_acceptable" => attrs["transport_condition_acceptable"],
      "dispatch_approved" => attrs["dispatch_approved"],
      "created_by_id" => actor.id,
      "updated_by_id" => actor.id
    }

    %ShipmentPickupEvent{}
    |> ShipmentPickupEvent.changeset(event_attrs)
    |> Repo.insert()
  end

  defp attach_files_to_event(%Shipment{id: shipment_id}, %ShipmentPickupEvent{id: event_id}, file_uuids) do
    if file_uuids == [] do
      :ok
    else
      {n, _} =
        from(f in ShipmentPickupFile,
          where:
            f.shipment_id == ^shipment_id and
              f.uuid in ^file_uuids and
              is_nil(f.shipment_pickup_event_id)
        )
        |> Repo.update_all(set: [shipment_pickup_event_id: event_id])

      if n == length(file_uuids), do: :ok, else: {:error, :pickup_file_link_mismatch}
    end
  end

  # After logging an event we re-derive the shipment status +
  # denormalise the LATEST event's driver / vehicle / checklist onto
  # the shipment row so existing consumers (portal, wizard, list
  # tables) that read the shipment row directly keep working.
  defp refresh_shipment_after_event(
         _actor,
         %Shipment{} = shipment,
         %ShipmentPickupEvent{} = event,
         _event_qty,
         attrs
       ) do
    reloaded_shipment = Repo.get!(Shipment, shipment.id)

    picked_total =
      Repo.one(
        from(e in ShipmentPickupEvent,
          where: e.shipment_id == ^shipment.id,
          select: coalesce(sum(e.qty), 0)
        )
      ) || Decimal.new(0)

    next_status =
      cond do
        Decimal.compare(picked_total, shipment.qty || Decimal.new(0)) in [:eq, :gt] ->
          "picked_up"

        true ->
          "partially_picked"
      end

    # ``carrier`` is a shipment-wide default (there's no per-event
    # column) but the mobile dispatch form is the only surface that
    # captures it — pipe the fresh value in from attrs when present so
    # the first truck initialises the "Delivery company" field the
    # desktop card falls back to. Subsequent visits with a different
    # value overwrite; blank/missing attrs leave the existing value
    # untouched.
    base_attrs = %{
      "status" => next_status,
      "picked_up_at" => event.picked_up_at,
      "picked_up_by_id" => event.picked_up_by_id,
      "driver_name" => event.driver_name,
      "vehicle_registration" => event.vehicle_registration,
      "consignment_note_ref" => event.consignment_note_ref,
      "packaging_intact" => event.packaging_intact,
      "labels_verified" => event.labels_verified,
      "vehicle_clean_suitable" => event.vehicle_clean_suitable,
      "transport_condition_acceptable" => event.transport_condition_acceptable,
      "dispatch_approved" => event.dispatch_approved
    }

    summary_attrs =
      case attrs["carrier"] do
        v when is_binary(v) and v != "" -> Map.put(base_attrs, "carrier", v)
        _ -> base_attrs
      end

    reloaded_shipment
    |> Shipment.pickup_event_summary_changeset(summary_attrs)
    |> Repo.update()
    |> case do
      {:ok, updated} -> {:ok, updated}
      {:error, %Ecto.Changeset{} = cs} -> {:error, cs}
    end
  end

  defp normalise_event_attrs(actor, shipment, attrs) do
    attrs
    |> normalise_map_keys()
    |> apply_checklist_defaults(shipment)
    |> Map.put_new("picked_up_at", DateTime.utc_now() |> DateTime.truncate(:second))
    |> Map.put_new("picked_up_by_id", actor.id)
    |> coerce_checklist_values()
  end

  defp normalise_map_keys(attrs) when is_map(attrs) do
    Enum.reduce(attrs, %{}, fn
      {k, v}, acc when is_atom(k) -> Map.put(acc, Atom.to_string(k), v)
      {k, v}, acc -> Map.put(acc, k, v)
    end)
  end

  defp normalise_map_keys(_), do: %{}

  # Legacy ``confirm_pickup`` callers passed the checklist on the
  # shipment itself; back-fill missing per-event booleans from the
  # shipment row so the shim keeps behaving identically.
  defp apply_checklist_defaults(attrs, %Shipment{} = shipment) do
    Enum.reduce(ShipmentPickupEvent.checklist_fields(), attrs, fn field, acc ->
      key = Atom.to_string(field)

      if Map.has_key?(acc, key) do
        acc
      else
        Map.put(acc, key, Map.get(shipment, field) || false)
      end
    end)
  end

  defp coerce_checklist_values(attrs) do
    Enum.reduce(ShipmentPickupEvent.checklist_fields(), attrs, fn field, acc ->
      key = Atom.to_string(field)

      case Map.get(acc, key) do
        v when is_boolean(v) -> acc
        v when v in ["true", 1, "1"] -> Map.put(acc, key, true)
        v when v in ["false", 0, "0", nil] -> Map.put(acc, key, false)
        _ -> acc
      end
    end)
  end

  defp ensure_qty_within_remaining(%Shipment{} = shipment, qty) do
    remaining = remaining_qty(shipment)

    cond do
      Decimal.compare(remaining, Decimal.new(0)) == :eq ->
        {:error, :nothing_left_to_pick_up}

      Decimal.compare(qty, remaining) == :gt ->
        {:error,
         {:qty_exceeds_remaining,
          %{qty: qty, remaining: remaining}}}

      true ->
        :ok
    end
  end

  # Returns the sanitised list of pickup-file uuids scoped to this
  # shipment. Callers pass the uuids of the files uploaded during
  # the event draft; we resolve them to make sure they belong to
  # this shipment (belt + braces against a hostile client).
  defp resolve_pickup_file_ids(_shipment, nil), do: {:ok, []}
  defp resolve_pickup_file_ids(_shipment, []), do: {:ok, []}

  defp resolve_pickup_file_ids(%Shipment{id: shipment_id}, uuids) when is_list(uuids) do
    cleaned = uuids |> Enum.map(&to_string/1) |> Enum.reject(&(&1 == ""))

    rows =
      Repo.all(
        from(f in ShipmentPickupFile,
          where: f.shipment_id == ^shipment_id and f.uuid in ^cleaned,
          select: f.uuid
        )
      )

    if length(rows) == length(cleaned) do
      {:ok, cleaned}
    else
      {:error, :pickup_file_not_found}
    end
  end

  defp resolve_pickup_file_ids(_shipment, _), do: {:error, :pickup_file_not_found}

  defp ensure_photo_count([]), do: {:error, :pickup_photo_required}
  defp ensure_photo_count(_), do: :ok

  defp pickup_files_without_event(%Shipment{id: id}) do
    Repo.all(
      from(f in ShipmentPickupFile,
        where: f.shipment_id == ^id and is_nil(f.shipment_pickup_event_id)
      )
    )
  end

  defp parse_positive_decimal(nil, field), do: {:error, {:required, field}}
  defp parse_positive_decimal(%Decimal{} = d, field), do: ensure_positive(d, field)

  defp parse_positive_decimal(n, field) when is_integer(n),
    do: ensure_positive(Decimal.new(n), field)

  defp parse_positive_decimal(n, field) when is_float(n),
    do: ensure_positive(Decimal.from_float(n), field)

  defp parse_positive_decimal(s, field) when is_binary(s) do
    case s |> String.trim() |> Decimal.parse() do
      {d, ""} -> ensure_positive(d, field)
      _ -> {:error, {:not_a_number, field}}
    end
  end

  defp parse_positive_decimal(_, field), do: {:error, {:not_a_number, field}}

  defp ensure_positive(%Decimal{} = d, field) do
    if Decimal.compare(d, Decimal.new(0)) == :gt do
      {:ok, d}
    else
      {:error, {:must_be_positive, field}}
    end
  end

  defp event_audit_snapshot(%ShipmentPickupEvent{} = e) do
    %{
      qty: e.qty,
      picked_up_at: e.picked_up_at,
      picked_up_by_id: e.picked_up_by_id,
      driver_name: e.driver_name,
      vehicle_registration: e.vehicle_registration,
      consignment_note_ref: e.consignment_note_ref,
      packaging_intact: e.packaging_intact,
      labels_verified: e.labels_verified,
      vehicle_clean_suitable: e.vehicle_clean_suitable,
      transport_condition_acceptable: e.transport_condition_acceptable,
      dispatch_approved: e.dispatch_approved,
      notes: e.notes
    }
  end


  @doc """
  Draft | Ready → cancelled with a reason.

  Belt + braces: even at ``ready``, we refuse if any pickup events
  already exist on the shipment. A shipment can technically sit at
  ``ready`` for a moment while a lone pickup event is being logged
  (the auto-transition to ``partially_picked`` lives inside the same
  transaction as the event insert) — checking the events table
  directly closes that race so we never wipe evidence of goods that
  have physically moved.
  """
  def cancel(%User{} = actor, %Shipment{} = shipment, reason) do
    with :ok <- ensure_edit(actor),
         :ok <- ensure_cancelable(shipment),
         :ok <- ensure_no_pickup_events(shipment) do
      before_state = shipment_snapshot(shipment)

      shipment
      |> Shipment.cancel_changeset(%{
        cancelled_at: DateTime.utc_now() |> DateTime.truncate(:second),
        cancelled_by_id: actor.id,
        cancel_reason: reason
      })
      |> Repo.update()
      |> tap_audit_updated(actor, before_state, "cancelled")
    end
  end

  # Absolute floor on cancel: if a truck has arrived and taken even
  # one visit's worth of goods, the shipment is no longer a paper
  # exercise — it's a real chain of custody. Cancelling it would
  # detach the audit trail from the physical movement. Instead the
  # operator must reduce the shipment qty on a separate top-up flow.
  defp ensure_no_pickup_events(%Shipment{id: id}) do
    count =
      Repo.aggregate(
        from(e in ShipmentPickupEvent, where: e.shipment_id == ^id),
        :count
      )

    if count == 0, do: :ok, else: {:error, :pickup_events_exist}
  end

  @doc """
  Legacy shim — kept as ``confirm_delivery`` for the staff detail
  page. Delegates to the per-event flow: confirms every
  outstanding event on the shipment in one shot.
  """
  def confirm_delivery(%User{} = actor, %Shipment{} = shipment, attrs \\ %{}) do
    with :ok <- ensure_confirm_delivery(actor) do
      confirm_all_undelivered_events(actor, shipment, attrs, "staff")
    end
  end

  @doc """
  Portal-side variant of :func:`confirm_delivery`. Fired when the
  customer confirms receipt on the sample detail page. Confirms
  every outstanding event on the shipment — same semantics as the
  staff shim, but ``delivered_by_id`` stays nil (customers aren't
  PSP users) and the audit row action tag is ``portal_confirmed``.
  """
  def confirm_delivery_from_portal(%Shipment{} = shipment, attrs \\ %{}) do
    confirm_all_undelivered_events(nil, shipment, attrs, "portal")
  end

  @doc """
  Per-event POD confirmation. Records the customer's / recipient's
  signatory + timestamp against ONE pickup event, then re-derives
  the shipment status: still ``picked_up`` if any event remains
  undelivered, flips to ``delivered`` once every event has been
  confirmed.

  ``actor`` may be ``nil`` — that's the portal path where the
  customer confirmed receipt themselves and there's no PSP user
  to attribute. The audit trail keeps the signatory instead.

  ``attrs`` shape (string OR atom keys):

      %{
        "recipient_signatory" => "...", # required
        "delivery_notes" => "...",       # optional
        "delivered_at" => datetime,       # optional, defaults to now
        "source" => "staff" | "portal"    # tags the audit row
      }
  """
  def confirm_pickup_event_delivery(actor, %ShipmentPickupEvent{} = event, attrs \\ %{}) do
    normalised = attrs |> stringify_top_keys() |> Map.delete("source")

    with :ok <- ensure_event_undelivered(event),
         attrs <- prepare_delivery_attrs(actor, normalised) do
      before_event = event_audit_snapshot(event)

      Repo.transaction(fn ->
        with {:ok, updated_event} <-
               event
               |> ShipmentPickupEvent.delivery_changeset(attrs)
               |> Repo.update(),
             {:ok, updated_shipment} <-
               reproject_shipment_after_delivery(event.shipment_id) do
          {updated_event, updated_shipment}
        else
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
      |> case do
        {:ok, {updated_event, updated_shipment}} ->
          Audit.record_updated(
            actor,
            "shipment_pickup_event",
            updated_event,
            before_event,
            event_audit_snapshot(updated_event)
          )

          Backend.Broadcasts.entity_changed(
            "shipment",
            updated_shipment.uuid,
            updated_shipment.company_id,
            "delivery_confirmed"
          )

          {:ok, {updated_event, updated_shipment}}

        err ->
          err
      end
    end
  end

  @doc """
  Amend paperwork on a specific pickup event AFTER the truck has
  left. Multi-visit shipments accumulate one row of paperwork per
  truck, and carriers often email the tracking number / seal number
  / temperature reading only after departure — the operator wants a
  place to type those in without re-opening the whole event.

  Only paperwork fields are cast; qty / checklist / photos stay
  immutable so the traceability rail on the event isn't rewriteable.
  Anyone with ``shipments.edit`` on a pre-dispatch shipment OR
  ``shipments.pickup`` on a post-dispatch shipment can amend — same
  gate ``ensure_carrier_perm`` uses on the top-level carrier card.
  """
  def update_pickup_event_paperwork(actor, %ShipmentPickupEvent{} = event, attrs \\ %{}) do
    shipment = Repo.get!(Shipment, event.shipment_id)

    with :ok <- ensure_carrier_perm(actor, shipment) do
      normalised = attrs |> stringify_top_keys() |> Map.put("updated_by_id", actor.id)
      before_event = event_audit_snapshot(event)

      event
      |> ShipmentPickupEvent.paperwork_changeset(normalised)
      |> Repo.update()
      |> case do
        {:ok, updated_event} ->
          Audit.record_updated(
            actor,
            "shipment_pickup_event",
            updated_event,
            before_event,
            event_audit_snapshot(updated_event)
          )

          Backend.Broadcasts.entity_changed(
            "shipment",
            shipment.uuid,
            shipment.company_id,
            "pickup_event_paperwork_updated"
          )

          {:ok, updated_event}

        {:error, %Ecto.Changeset{} = cs} ->
          {:error, cs}
      end
    end
  end

  # Bulk confirm all outstanding events on a shipment (staff or
  # portal single-visit legacy path). Each event gets its own
  # audit row + shipment status re-projected once at the end.
  defp confirm_all_undelivered_events(actor, %Shipment{} = shipment, attrs, source) do
    events =
      Repo.all(
        from(e in ShipmentPickupEvent,
          where: e.shipment_id == ^shipment.id and is_nil(e.delivered_at)
        )
      )

    cond do
      events == [] ->
        {:error, :nothing_to_confirm}

      true ->
        prepared = prepare_delivery_attrs(actor, Map.put(attrs, "source", source))

        Repo.transaction(fn ->
          Enum.each(events, fn e ->
            case e |> ShipmentPickupEvent.delivery_changeset(prepared) |> Repo.update() do
              {:ok, _} -> :ok
              {:error, cs} -> Repo.rollback(cs)
            end
          end)

          case reproject_shipment_after_delivery(shipment.id) do
            {:ok, updated} -> updated
            {:error, reason} -> Repo.rollback(reason)
          end
        end)
        |> case do
          {:ok, updated} ->
            Backend.Broadcasts.entity_changed(
              "shipment",
              updated.uuid,
              updated.company_id,
              "delivery_confirmed"
            )

            {:ok, updated}

          err ->
            err
        end
    end
  end

  defp reproject_shipment_after_delivery(shipment_id) do
    outstanding_events =
      Repo.aggregate(
        from(e in ShipmentPickupEvent,
          where: e.shipment_id == ^shipment_id and is_nil(e.delivered_at)
        ),
        :count
      )

    shipment = Repo.get!(Shipment, shipment_id)

    # A shipment is only fully delivered when EVERY event has a POD
    # AND the sum of event qtys covers the shipment's total. A partial
    # first pickup (1 000 of 9 564) confirmed as delivered must not
    # flip the whole shipment — the remaining 8 564 units still owe
    # truck visits, so the shipment stays on the mobile pickup queue
    # under ``partially_picked``.
    picked_total = picked_up_qty(shipment)
    shipment_total = shipment.qty || Decimal.new(0)
    qty_fully_picked? = Decimal.compare(picked_total, shipment_total) in [:eq, :gt]

    if outstanding_events == 0 and qty_fully_picked? do
      # Every event delivered → flip the shipment. The denormalised
      # ``delivered_at`` mirrors the LATEST event's delivery stamp so
      # the existing "when was this delivered?" reads keep working.
      latest =
        Repo.one(
          from(e in ShipmentPickupEvent,
            where: e.shipment_id == ^shipment_id,
            order_by: [desc: e.delivered_at, desc: e.id],
            limit: 1
          )
        )

      shipment
      |> Ecto.Changeset.change(%{
        status: "delivered",
        delivered_at: latest && latest.delivered_at,
        delivered_by_id: latest && latest.delivered_by_id,
        recipient_signatory: latest && latest.recipient_signatory,
        delivery_notes: latest && latest.delivery_notes
      })
      |> Repo.update()
    else
      {:ok, shipment}
    end
  end

  defp ensure_event_undelivered(%ShipmentPickupEvent{delivered_at: nil}), do: :ok
  defp ensure_event_undelivered(_), do: {:error, :event_already_delivered}

  defp prepare_delivery_attrs(actor, attrs) do
    attrs
    |> stringify_top_keys()
    |> Map.put("delivered_by_id", actor && actor.id)
    |> Map.put_new_lazy("delivered_at", fn ->
      DateTime.utc_now() |> DateTime.truncate(:second)
    end)
  end

  # Map may arrive with atom or string keys (server-side controller vs
  # test); normalise so the changeset cast sees a consistent shape.
  defp stringify_top_keys(attrs) when is_map(attrs) do
    Enum.reduce(attrs, %{}, fn
      {k, v}, acc when is_atom(k) -> Map.put(acc, Atom.to_string(k), v)
      {k, v}, acc -> Map.put(acc, k, v)
    end)
  end

  defp stringify_top_keys(_), do: %{}

  # ==================================================================
  # Queries
  # ==================================================================

  @doc "Full paginated queue for the /shipments list page."
  def list_shipments(company_id, opts \\ []) when is_integer(company_id) do
    status = Keyword.get(opts, :status)
    limit = Keyword.get(opts, :limit, 25) |> min(100)
    cursor = Keyword.get(opts, :cursor)
    search = Keyword.get(opts, :search)

    {customer_needle, _column_filter} =
      Backend.ListQueries.pop_joined_text_filter(opts[:column_filter], "customer")

    q =
      from(s in Shipment,
        where: s.company_id == ^company_id,
        preload: [
          :customer,
          :created_by,
          :ready_by,
          :picked_up_by,
          :delivered_by,
          pickup_files: [:uploaded_by],
          delivery_files: [:uploaded_by],
          stock_lot: [
            :item,
            :unit_of_measurement,
            :bailee_customer,
            # `shipment_lot_summary` in Payloads walks
            # placements → storage_cell → storage_location → floor →
            # warehouse to render the row's warehouse chip; and
            # `dispatch_dwell_summary` walks placements → storage_cell
            # for the dispatch-purpose match. Preload the whole chain
            # so neither path hits Ecto.Association.NotLoaded.
            placements: [storage_cell: [storage_location: [floor: :warehouse]]]
          ]
        ],
        order_by: [desc: s.inserted_at, desc: s.id]
      )

    q =
      case status do
        s when is_binary(s) and s != "" and s != "all" -> where(q, [s], s.status == ^s)
        _ -> q
      end

    q =
      case cursor do
        c when is_binary(c) and c != "" ->
          case Integer.parse(c) do
            {id, ""} -> where(q, [s], s.id < ^id)
            _ -> q
          end

        _ ->
          q
      end

    q =
      case search do
        s when is_binary(s) and s != "" ->
          like = "%" <> Backend.ListQueries.escape_like(s) <> "%"

          from s in q,
            left_join: l in assoc(s, :stock_lot),
            left_join: c in assoc(s, :customer),
            where:
              ilike(s.recipient_name, ^like) or
                ilike(s.consignment_note_ref, ^like) or
                ilike(s.vehicle_registration, ^like) or
                ilike(l.supplier_batch_no, ^like) or
                ilike(c.name, ^like)

        _ ->
          q
      end

    q =
      case customer_needle do
        nil ->
          q

        needle ->
          like = "%" <> Backend.ListQueries.escape_like(needle) <> "%"

          from s in q,
            join: c in Backend.Customers.Customer,
            on: c.id == s.customer_id,
            where: ilike(c.name, ^like) or ilike(c.legal_name, ^like)
      end

    rows = Repo.all(from x in q, limit: ^(limit + 1))

    {items, next_cursor} =
      case Enum.split(rows, limit) do
        {items, [next | _]} -> {items, Integer.to_string(next.id)}
        {items, []} -> {items, nil}
      end

    {items, next_cursor}
  end

  @doc """
  Mobile pickup queue — shipments marked ``ready`` for this tenant,
  earliest planned-ship first. Keyset paginated on
  ``(planned_ship_at ASC NULLS LAST, id ASC)`` so a table with
  millions of rows costs the same per page as an empty one, given
  the partial ``shipments_ready_queue_idx`` migration.

  Args:

    * ``company_id`` (required) — tenant scope.
    * ``opts``:
      * ``:limit`` — page size (default 25, hard cap 100).
      * ``:cursor`` — opaque encoded cursor from the previous page,
        or ``nil`` for the first page. Shape: ``"<epoch>|<id>"`` or
        ``"|<id>"`` when the previous last row had no
        ``planned_ship_at``.
      * ``:search`` — free-text filter over recipient / consignment
        note ref / vehicle registration / lot batch / customer
        name / ship-to address. Same fields as ``list_shipments``'s
        needle, so operators build one mental model.

  Returns ``{items, next_cursor_string_or_nil}``. Each item is a
  fully-preloaded ``%Shipment{}`` — cheap enough at page size 25
  because the query walks only ``ready`` rows.
  """
  def list_ready_for_pickup(company_id, opts \\ []) when is_integer(company_id) do
    limit = Keyword.get(opts, :limit, 25) |> min(100) |> max(1)
    cursor = Keyword.get(opts, :cursor)
    search = Keyword.get(opts, :search)

    # ``partially_picked`` shipments still owe truck visits — they
    # belong on the same queue as ``ready`` so the next truck's
    # operator can find the shipment and log the next event. The
    # partial index widens with the same status list (see migration
    # 20260827190000).
    q =
      from(s in Shipment,
        where:
          s.company_id == ^company_id and
            s.status in ["ready", "partially_picked"],
        preload: [
          :customer,
          :customer_order,
          stock_lot: [:item, :unit_of_measurement, :bailee_customer]
        ],
        order_by: [
          asc_nulls_last: s.planned_ship_at,
          asc: s.id
        ]
      )

    q = apply_ready_cursor(q, cursor)

    q =
      case search do
        s when is_binary(s) and s != "" ->
          like = "%" <> Backend.ListQueries.escape_like(s) <> "%"

          from s in q,
            left_join: l in assoc(s, :stock_lot),
            left_join: c in assoc(s, :customer),
            where:
              ilike(s.recipient_name, ^like) or
                ilike(s.consignment_note_ref, ^like) or
                ilike(s.vehicle_registration, ^like) or
                ilike(s.ship_to_address, ^like) or
                ilike(l.supplier_batch_no, ^like) or
                ilike(c.name, ^like)

        _ ->
          q
      end

    rows = Repo.all(from x in q, limit: ^(limit + 1))

    {items, next_cursor} =
      case Enum.split(rows, limit) do
        {items, [next | _]} -> {items, encode_ready_cursor(next)}
        {items, []} -> {items, nil}
      end

    {items, next_cursor}
  end

  # Cursor shape: "<unix_epoch_seconds>|<id>" for rows with a
  # ``planned_ship_at`` (the common case — ``mark_ready`` validates
  # the field is present, so every ``ready`` row we land ships one),
  # or "|<id>" for the tail of NULL-planned rows so pagination still
  # makes forward progress. Callers treat the whole string as opaque.
  defp encode_ready_cursor(%Shipment{planned_ship_at: %DateTime{} = dt, id: id}) do
    "#{DateTime.to_unix(dt)}|#{id}"
  end

  defp encode_ready_cursor(%Shipment{id: id}), do: "|#{id}"

  defp apply_ready_cursor(q, cursor) when is_binary(cursor) and cursor != "" do
    case String.split(cursor, "|", parts: 2) do
      ["", id_str] ->
        case Integer.parse(id_str) do
          {id, ""} ->
            # Continuing inside the NULL-planned tail: only rows with
            # NULL planned_ship_at and a larger id are after us.
            from s in q, where: is_nil(s.planned_ship_at) and s.id > ^id

          _ ->
            q
        end

      [epoch_str, id_str] ->
        with {epoch, ""} <- Integer.parse(epoch_str),
             {id, ""} <- Integer.parse(id_str),
             {:ok, dt} <- DateTime.from_unix(epoch) do
          from s in q,
            where:
              s.planned_ship_at > ^dt or
                (s.planned_ship_at == ^dt and s.id > ^id) or
                is_nil(s.planned_ship_at)
        else
          _ -> q
        end

      _ ->
        q
    end
  end

  defp apply_ready_cursor(q, _), do: q

  @doc "Fetch by uuid, scoped to company. Preloads everything the FE " <>
         "detail page needs."
  def get_shipment(company_id, uuid) when is_integer(company_id) and is_binary(uuid) do
    case Repo.get_by(Shipment, uuid: uuid, company_id: company_id) do
      nil ->
        nil

      shipment ->
        Repo.preload(shipment, [
          :customer,
          :customer_order,
          :created_by,
          :ready_by,
          :picked_up_by,
          :delivered_by,
          :cancelled_by,
          pickup_files: [:uploaded_by],
          pickup_events: [:picked_up_by, photos: [:uploaded_by]],
          delivery_files: [:uploaded_by],
          stock_lot: [
            :item,
            :unit_of_measurement,
            :bailee_customer,
            placements: [storage_cell: [storage_location: [floor: [:warehouse]]]]
          ]
        ])
    end
  end

  # ==================================================================
  # Dispatch-cell dwell + carrying-cost estimate
  # ==================================================================

  @doc """
  When did `lot`'s stock physically land in a dispatch cell? Uses the
  most recent stock movement whose `to_cell` has purpose "dispatch".
  Returns `nil` for lots that have never touched a dispatch cell.

  This is what starts the "how long has this been sitting waiting for
  the truck" clock — matches how a warehouse manager would think
  about it, independent of when the paperwork (shipment record) was
  first opened.
  """
  def dispatch_arrived_at(lot_id) when is_integer(lot_id) do
    from(m in Movement,
      join: c in StorageCell,
      on: c.id == m.to_cell_id,
      where: m.stock_lot_id == ^lot_id and c.purpose == "dispatch",
      order_by: [desc: m.occurred_at],
      limit: 1,
      select: m.occurred_at
    )
    |> Repo.one()
  end

  @doc """
  Bundle of "how long has this lot been staged" + estimated carrying
  cost so far. Returns `nil` when the lot has never been in dispatch;
  callers hide the banner in that case.

  `rate` is `company.three_pl_rate_per_m3_per_day` — reused as the
  proxy for own-stock carrying cost. If the company hasn't set the
  3PL rate we still return the dwell (so the operator sees the wait)
  but `estimated_storage_cost` is nil.

  Math mirrors `Backend.ThreePL.accrued_charge/2`: full days ×
  volume-in-cell × rate. Fractional days round down so the banner
  doesn't imply we've charged for a partial day.
  """
  def dispatch_dwell_summary(%Lot{} = lot, rate) do
    case dispatch_arrived_at(lot.id) do
      nil ->
        nil

      %DateTime{} = arrived ->
        dwell_seconds = max(DateTime.diff(DateTime.utc_now(), arrived, :second), 0)
        volume = dispatch_placement_volume_m3(lot)

        estimated =
          cond do
            is_nil(rate) ->
              nil

            Decimal.compare(volume, Decimal.new(0)) == :eq ->
              Decimal.new(0)

            true ->
              days = div(dwell_seconds, 86_400)

              Decimal.new(days)
              |> Decimal.mult(volume)
              |> Decimal.mult(rate)
          end

        %{
          arrived_at: arrived,
          dwell_seconds: dwell_seconds,
          volume_m3: volume,
          estimated_storage_cost: estimated
        }
    end
  end

  defp dispatch_placement_volume_m3(%Lot{} = lot) do
    case find_dispatch_placement_qty(lot) do
      {:ok, qty} -> Backend.ThreePL.volume_m3_for_qty(lot, qty)
      _ -> Decimal.new(0)
    end
  end

  # ==================================================================
  # Pickup files
  # ==================================================================

  @doc "Persist a pickup-file metadata row after the bytes have been " <>
         "stored via `Backend.Storage.put/3`."
  def record_pickup_file(%User{} = actor, %Shipment{} = shipment, attrs) do
    attrs =
      attrs
      |> Map.put("company_id", shipment.company_id)
      |> Map.put("shipment_id", shipment.id)
      |> Map.put("uploaded_by_id", actor.id)

    case %ShipmentPickupFile{}
         |> ShipmentPickupFile.changeset(attrs)
         |> Repo.insert() do
      {:ok, file} = ok ->
        Backend.Broadcasts.entity_changed(
          "shipment",
          shipment.uuid,
          shipment.company_id,
          "pickup_file_added"
        )

        _ = file
        ok

      other ->
        other
    end
  end

  @doc "List every photo captured on this shipment's dispatch form."
  def list_pickup_files(%Shipment{id: shipment_id}) do
    Repo.all(
      from(f in ShipmentPickupFile,
        where: f.shipment_id == ^shipment_id,
        order_by: [asc: f.inserted_at, asc: f.id],
        preload: [:uploaded_by]
      )
    )
  end

  @doc "Fetch one pickup file by uuid, scoped to the shipment."
  def get_pickup_file(shipment_id, file_uuid) when is_integer(shipment_id) and is_binary(file_uuid) do
    case Ecto.UUID.cast(file_uuid) do
      {:ok, cast} ->
        Repo.one(
          from(f in ShipmentPickupFile,
            where: f.shipment_id == ^shipment_id and f.uuid == ^cast
          )
        )

      :error ->
        nil
    end
  end

  def get_pickup_file(_, _), do: nil

  @doc "Delete a pickup file (metadata + blob)."
  def delete_pickup_file(%User{} = _actor, %ShipmentPickupFile{} = file) do
    _ = Backend.Storage.delete(file.blob_path)

    case Repo.delete(file) do
      {:ok, deleted} = ok ->
        shipment_uuid =
          case Repo.get(Shipment, file.shipment_id) do
            %Shipment{uuid: uuid} -> uuid
            _ -> nil
          end

        Backend.Broadcasts.entity_changed(
          "shipment",
          shipment_uuid,
          file.company_id,
          "pickup_file_deleted"
        )

        _ = deleted
        ok

      other ->
        other
    end
  end

  # ==================================================================
  # Delivery files
  # ==================================================================

  @doc "Persist a delivery-file metadata row after the bytes have been " <>
         "stored via `Backend.Storage.put/3`."
  def record_delivery_file(%User{} = actor, %Shipment{} = shipment, attrs) do
    attrs =
      attrs
      |> Map.put("company_id", shipment.company_id)
      |> Map.put("shipment_id", shipment.id)
      |> Map.put("uploaded_by_id", actor.id)

    case %ShipmentDeliveryFile{}
         |> ShipmentDeliveryFile.changeset(attrs)
         |> Repo.insert() do
      {:ok, file} = ok ->
        Backend.Broadcasts.entity_changed(
          "shipment",
          shipment.uuid,
          shipment.company_id,
          "delivery_file_added"
        )

        _ = file
        ok

      other ->
        other
    end
  end

  @doc "List every photo attached to this shipment's delivery confirmation."
  def list_delivery_files(%Shipment{id: shipment_id}) do
    Repo.all(
      from(f in ShipmentDeliveryFile,
        where: f.shipment_id == ^shipment_id,
        order_by: [asc: f.inserted_at, asc: f.id],
        preload: [:uploaded_by]
      )
    )
  end

  @doc "Fetch one delivery file by uuid, scoped to the shipment."
  def get_delivery_file(shipment_id, file_uuid) when is_integer(shipment_id) and is_binary(file_uuid) do
    case Ecto.UUID.cast(file_uuid) do
      {:ok, cast} ->
        Repo.one(
          from(f in ShipmentDeliveryFile,
            where: f.shipment_id == ^shipment_id and f.uuid == ^cast
          )
        )

      :error ->
        nil
    end
  end

  def get_delivery_file(_, _), do: nil

  @doc "Delete a delivery file (metadata + blob)."
  def delete_delivery_file(%User{} = _actor, %ShipmentDeliveryFile{} = file) do
    _ = Backend.Storage.delete(file.blob_path)

    case Repo.delete(file) do
      {:ok, deleted} = ok ->
        shipment_uuid =
          case Repo.get(Shipment, file.shipment_id) do
            %Shipment{uuid: uuid} -> uuid
            _ -> nil
          end

        Backend.Broadcasts.entity_changed(
          "shipment",
          shipment_uuid,
          file.company_id,
          "delivery_file_deleted"
        )

        _ = deleted
        ok

      other ->
        other
    end
  end

  # ==================================================================
  # Private helpers
  # ==================================================================

  defp ensure_edit(actor) do
    if RBAC.has_permission?(actor, @perm_edit),
      do: :ok,
      else: {:error, :forbidden}
  end

  defp ensure_pickup(actor) do
    if RBAC.has_permission?(actor, @perm_pickup),
      do: :ok,
      else: {:error, :forbidden}
  end

  defp ensure_confirm_delivery(actor) do
    if RBAC.has_permission?(actor, @perm_confirm_delivery),
      do: :ok,
      else: {:error, :forbidden}
  end

  defp ensure_editable(%Shipment{status: s}) when s in ~w(draft ready), do: :ok
  defp ensure_editable(_), do: {:error, :not_editable}

  defp ensure_status(%Shipment{status: expected}, expected) when is_binary(expected), do: :ok

  defp ensure_status(%Shipment{status: got}, expected) when is_binary(expected),
    do: {:error, {:bad_status, got: got, expected: expected}}

  defp ensure_status(%Shipment{status: got}, expected) when is_list(expected) do
    if got in expected do
      :ok
    else
      {:error, {:bad_status, got: got, expected: expected}}
    end
  end

  defp ensure_cancelable(%Shipment{status: s}) when s in ~w(draft ready), do: :ok
  defp ensure_cancelable(_), do: {:error, :not_cancelable}

  defp fetch_lot(company_id, lot_uuid) do
    case Repo.get_by(Lot, uuid: lot_uuid) do
      %Lot{company_id: ^company_id} = lot ->
        {:ok,
         Repo.preload(lot, [
           :bailee_customer,
           placements: [storage_cell: []]
         ])}

      _ ->
        {:error, :lot_not_found}
    end
  end

  # The lot must have an active placement in a dispatch cell. Returns
  # the qty currently sitting there — becomes the default shipment
  # qty (operator can override on the form).
  defp find_dispatch_placement_qty(%Lot{placements: placements}) when is_list(placements) do
    match =
      Enum.find(placements, fn p ->
        p.storage_cell && p.storage_cell.purpose == "dispatch" &&
          p.qty && Decimal.compare(p.qty, Decimal.new(0)) == :gt
      end)

    case match do
      %Placement{qty: q} -> {:ok, q}
      _ -> {:error, :lot_not_in_dispatch}
    end
  end

  # Callers that hit this without placements preloaded (e.g. the list
  # endpoint's payload builder) get :not_loaded so they can render a
  # nil dwell block rather than blow up.
  defp find_dispatch_placement_qty(%Lot{}), do: {:error, :placements_not_loaded}

  defp ensure_no_open_shipment(%Lot{id: lot_id}) do
    exists =
      Repo.exists?(
        from s in Shipment,
          where: s.stock_lot_id == ^lot_id and s.status in ["draft", "ready"]
      )

    if exists, do: {:error, :already_open}, else: :ok
  end

  # Prefer the lot's bailee customer (3PL flow's already-linked
  # customer). Fall back to the customer order's customer via the MO
  # chain (own-stock direct shipment case).
  defp derive_customer_id(%Lot{bailee_customer: %Customer{id: id}}), do: id

  defp derive_customer_id(%Lot{id: lot_id}) do
    Repo.one(
      from mo in ManufacturingOrder,
        join: col in CustomerOrderLine,
        on: col.id == mo.customer_order_line_id,
        join: co in assoc(col, :customer_order),
        where: mo.produced_lot_id == ^lot_id,
        select: co.customer_id,
        limit: 1
    )
  end

  defp derive_customer_order_id(%Lot{id: lot_id}) do
    Repo.one(
      from mo in ManufacturingOrder,
        join: col in CustomerOrderLine,
        on: col.id == mo.customer_order_line_id,
        where: mo.produced_lot_id == ^lot_id,
        select: col.customer_order_id,
        limit: 1
    )
  end

  defp derive_customer_order_line_id(%Lot{id: lot_id}) do
    Repo.one(
      from mo in ManufacturingOrder,
        where: mo.produced_lot_id == ^lot_id,
        select: mo.customer_order_line_id,
        limit: 1
    )
  end

  # Silence the unused-alias warning while keeping StorageCell handy
  # for future capacity-check work.
  @doc false
  def __storage_cell_module__, do: StorageCell
end
