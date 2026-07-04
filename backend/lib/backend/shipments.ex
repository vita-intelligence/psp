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
  alias Backend.Shipments.Shipment
  alias Backend.Stock.Lot
  alias Backend.Warehouses.StorageCell
  alias Backend.Stock.Placement

  # Same capability as final release + 3PL routing — this is the
  # follow-up paperwork on the same operator's plate. Splitting into
  # its own permission is overkill.
  @perm "production.final_release"

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
    with :ok <- ensure_permission(actor),
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

  @doc "Edit fields on a draft or ready shipment."
  def update(%User{} = actor, %Shipment{} = shipment, attrs) do
    with :ok <- ensure_permission(actor),
         :ok <- ensure_editable(shipment) do
      before_state = shipment_snapshot(shipment)

      shipment
      |> Shipment.update_changeset(attrs)
      |> Repo.update()
      |> tap_audit_updated(actor, before_state)
    end
  end

  @doc "Draft → ready. Required paperwork fields must be filled."
  def mark_ready(%User{} = actor, %Shipment{} = shipment) do
    with :ok <- ensure_permission(actor),
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
    with :ok <- ensure_permission(actor),
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
  def confirm_pickup(%User{} = actor, %Shipment{} = shipment) do
    with :ok <- ensure_permission(actor),
         :ok <- ensure_status(shipment, "ready") do
      before_state = shipment_snapshot(shipment)

      shipment
      |> Shipment.pickup_changeset(%{
        picked_up_at: DateTime.utc_now() |> DateTime.truncate(:second),
        picked_up_by_id: actor.id
      })
      |> Repo.update()
      |> tap_audit_updated(actor, before_state)
    end
  end

  @doc "Draft | Ready → cancelled with a reason."
  def cancel(%User{} = actor, %Shipment{} = shipment, reason) do
    with :ok <- ensure_permission(actor),
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

  # ==================================================================
  # Queries
  # ==================================================================

  @doc "Full paginated queue for the /shipments list page."
  def list_shipments(company_id, opts \\ []) when is_integer(company_id) do
    status = Keyword.get(opts, :status)
    limit = Keyword.get(opts, :limit, 25) |> min(100)
    cursor = Keyword.get(opts, :cursor)
    search = Keyword.get(opts, :search)

    q =
      from(s in Shipment,
        where: s.company_id == ^company_id,
        preload: [
          :customer,
          :created_by,
          :ready_by,
          :picked_up_by,
          stock_lot: [:item, :unit_of_measurement, :bailee_customer]
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
          like = "%" <> s <> "%"

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
          :cancelled_by,
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
  # Private helpers
  # ==================================================================

  defp ensure_permission(actor) do
    if RBAC.has_permission?(actor, @perm), do: :ok, else: {:error, :forbidden}
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
  defp find_dispatch_placement_qty(%Lot{placements: placements}) do
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
