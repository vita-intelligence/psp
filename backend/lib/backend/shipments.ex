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
  alias Backend.Shipments.{Shipment, ShipmentPickupFile, ShipmentDeliveryFile}
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
  def create_from_lot(%User{} = actor, lot_uuid) when is_binary(lot_uuid) do
    with :ok <- ensure_edit(actor),
         {:ok, lot} <- fetch_lot(actor.company_id, lot_uuid),
         {:ok, dispatch_qty} <- find_dispatch_placement_qty(lot),
         :ok <- ensure_no_open_shipment(lot) do
      customer_id = derive_customer_id(lot)
      customer_order_id = derive_customer_order_id(lot)

      %Shipment{}
      |> Shipment.create_changeset(%{
        company_id: actor.company_id,
        stock_lot_id: lot.id,
        customer_id: customer_id,
        customer_order_id: customer_order_id,
        qty: dispatch_qty,
        created_by_id: actor.id,
        status: "draft"
      })
      |> Repo.insert()
      |> tap_audit_created(actor)
    end
  end

  defp tap_audit_created({:ok, %Shipment{} = row}, actor) do
    Audit.record_created(actor, "shipment", row, shipment_snapshot(row))
    {:ok, row}
  end

  defp tap_audit_created(other, _actor), do: other

  defp tap_audit_updated({:ok, %Shipment{} = row}, actor, before_state) do
    Audit.record_updated(
      actor,
      "shipment",
      row,
      before_state,
      shipment_snapshot(row)
    )

    {:ok, row}
  end

  defp tap_audit_updated(other, _actor, _before), do: other

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
      |> tap_audit_updated(actor, before_state)
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
      |> tap_audit_updated(actor, before_state)
    end
  end

  @doc """
  Ready → picked_up. The truck-arrival mobile form is the eventual
  home for driver signature + BOL photos; this stub just flags that
  the goods left so the wizard can advance.
  """
  def confirm_pickup(%User{} = actor, %Shipment{} = shipment, attrs \\ %{}) do
    with :ok <- ensure_pickup(actor),
         :ok <- ensure_status(shipment, "ready"),
         :ok <- ensure_pickup_photo(shipment) do
      before_state = shipment_snapshot(shipment)

      pickup_attrs =
        attrs
        |> normalise_pickup_attrs()
        |> Map.put("picked_up_at", DateTime.utc_now() |> DateTime.truncate(:second))
        |> Map.put("picked_up_by_id", actor.id)

      shipment
      |> Shipment.pickup_changeset(pickup_attrs)
      |> Repo.update()
      |> tap_audit_updated(actor, before_state)
    end
  end

  # Photos are captured before the operator taps Confirm. Enforce at
  # least one so the BRCGS visual-record requirement is met. Query the
  # count directly to sidestep whatever preload state the caller
  # happened to hand us.
  defp ensure_pickup_photo(%Shipment{id: shipment_id}) do
    count =
      Repo.aggregate(
        from(f in ShipmentPickupFile, where: f.shipment_id == ^shipment_id),
        :count
      )

    if count > 0, do: :ok, else: {:error, :pickup_photo_required}
  end

  # Accept string- or atom-keyed maps and normalise checklist values to
  # strict booleans so the changeset's `true`-check bites correctly
  # (`"true"` from a form or `1` from JS would sneak past a coarse
  # `truthy?` guard).
  defp normalise_pickup_attrs(attrs) when is_map(attrs) do
    stringified =
      Enum.reduce(attrs, %{}, fn
        {k, v}, acc when is_atom(k) -> Map.put(acc, Atom.to_string(k), v)
        {k, v}, acc -> Map.put(acc, k, v)
      end)

    Enum.reduce(Shipment.pickup_checklist_fields(), stringified, fn field, acc ->
      key = Atom.to_string(field)

      case Map.get(acc, key) do
        v when is_boolean(v) -> acc
        v when v in ["true", 1, "1"] -> Map.put(acc, key, true)
        v when v in ["false", 0, "0", nil] -> Map.put(acc, key, false)
        _ -> acc
      end
    end)
  end

  defp normalise_pickup_attrs(_), do: %{}

  @doc "Draft | Ready → cancelled with a reason."
  def cancel(%User{} = actor, %Shipment{} = shipment, reason) do
    with :ok <- ensure_edit(actor),
         :ok <- ensure_cancelable(shipment) do
      before_state = shipment_snapshot(shipment)

      shipment
      |> Shipment.cancel_changeset(%{
        cancelled_at: DateTime.utc_now() |> DateTime.truncate(:second),
        cancelled_by_id: actor.id,
        cancel_reason: reason
      })
      |> Repo.update()
      |> tap_audit_updated(actor, before_state)
    end
  end

  @doc """
  Picked_up → delivered. Records who confirmed the POD, when, the
  named recipient signatory, and any notes. Photos are optional and
  attached separately via the delivery-file endpoints before the
  operator submits the confirmation.
  """
  def confirm_delivery(%User{} = actor, %Shipment{} = shipment, attrs \\ %{}) do
    with :ok <- ensure_confirm_delivery(actor),
         :ok <- ensure_status(shipment, "picked_up") do
      before_state = shipment_snapshot(shipment)

      delivery_attrs =
        attrs
        |> stringify_top_keys()
        |> Map.put("delivered_by_id", actor.id)
        |> Map.put_new_lazy("delivered_at", fn ->
          DateTime.utc_now() |> DateTime.truncate(:second)
        end)

      shipment
      |> Shipment.delivery_changeset(delivery_attrs)
      |> Repo.update()
      |> tap_audit_updated(actor, before_state)
    end
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

    %ShipmentPickupFile{}
    |> ShipmentPickupFile.changeset(attrs)
    |> Repo.insert()
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
    Repo.delete(file)
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

    %ShipmentDeliveryFile{}
    |> ShipmentDeliveryFile.changeset(attrs)
    |> Repo.insert()
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
    Repo.delete(file)
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

  defp ensure_status(%Shipment{status: expected}, expected), do: :ok
  defp ensure_status(%Shipment{status: got}, expected),
    do: {:error, {:bad_status, got: got, expected: expected}}

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

  # Silence the unused-alias warning while keeping StorageCell handy
  # for future capacity-check work.
  @doc false
  def __storage_cell_module__, do: StorageCell
end
