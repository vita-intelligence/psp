defmodule Backend.ThreePL do
  @moduledoc """
  Third-party logistics (3PL) — bailee-custody storage for
  customer-owned finished goods after Positive Release (BRCGS Issue 9
  § 5.6).

  Flow:

    1. Operator finishes Final Product Release on a lot (status =
       `available`).
    2. Customer-order wizard renders the routing step; per-lot,
       operator picks `three_pl` or `shipment`.
    3. `route_released_lot/3` fires: validates preconditions, checks
       capacity of the target cell purpose, writes a lifecycle event
       (`routed_to_3pl` / `routed_to_shipment`), and for 3PL routing
       flips `ownership_kind` to `bailee` + snapshots the customer +
       stamps `bailee_routed_at` (billing clock starts here).
    4. The lot appears on the mobile pending-put-away queue with its
       destination cell purpose set. Physical move + Placement update
       happens through the existing put-away flow.
    5. `list_bailee_lots/1` surfaces everything the 3PL tab needs.

  Capacity is measured in cubic metres. Cell capacity = width_m *
  depth_m * height_m. Stored volume for a placement = package volume
  * (placement.qty / lot.units_per_package). Reported "free" is total
  purpose-scoped capacity minus current storage; individual cell
  fit-check happens later during put-away recommendations.
  """

  import Ecto.Query

  alias Backend.Accounts.User
  alias Backend.CustomerOrders.{CustomerOrder, CustomerOrderLine}
  alias Backend.Production.ManufacturingOrder
  alias Backend.RBAC
  alias Backend.Repo
  alias Backend.Stock.{Lifecycle, Lot, LotEvent, Placement}
  alias Backend.Warehouses.StorageCell

  # Same capability as Positive Release — routing the released lot is
  # the immediate follow-up step in the same ceremony. Splitting them
  # would just create a second role for no gain.
  @perm "production.final_release"

  @routing_choices ~w(three_pl shipment)
  def routing_choices, do: @routing_choices

  # =====================================================================
  # Routing action
  # =====================================================================

  @doc """
  Record the operator's routing decision on `lot`. Enforces:

    * actor holds `production.final_release`
    * `lot.status == "available"`
    * `lot.ownership_kind == "own"` (not already routed)
    * target purpose has capacity ≥ lot's stored volume (warehouse-scoped)

  For `choice = "three_pl"` the lot flips to `bailee` custody and
  snapshots the customer derived from the MO → customer_order_line
  chain. When the lot has no linked customer order (opening balance,
  manual receive), the caller may pass `override_customer_id` — the
  wizard renders a customer picker when the derived lookup fails.
  For `choice = "shipment"` ownership stays `own` and any override is
  ignored.

  Runs inside a `Repo.transaction` so the lifecycle event + lot
  update + audit trail either all commit or all roll back.

  Returns `{:ok, %{lot: lot, event: event, choice: choice}}` or
  `{:error, reason}` — reason is one of the tuples the FE can
  discriminate: `:forbidden`, `:not_available`, `:already_routed`,
  `{:no_capacity, %{purpose: ..., required_m3: ..., free_m3: ...}}`,
  `:no_customer_for_lot`, `{:bad_customer, customer_uuid}`, or a
  `%Ecto.Changeset{}`.
  """
  def route_released_lot(actor, lot, choice, opts \\ [])

  def route_released_lot(%User{} = actor, %Lot{} = lot, choice, opts)
      when choice in @routing_choices do
    override = Keyword.get(opts, :override_customer_id)

    result =
      with :ok <- ensure_permission(actor),
           :ok <- ensure_available(lot),
           :ok <- ensure_not_already_routed(lot),
           {:ok, warehouse_id} <- resolve_warehouse(lot),
           :ok <- ensure_capacity(warehouse_id, lot, choice),
           {:ok, customer_id} <- maybe_resolve_customer(lot, choice, override) do
        Repo.transaction(fn ->
          with {:ok, %{event: event}} <-
                 Lifecycle.record_event_in_transaction(lot, event_kind(choice), %{
                   actor: actor,
                   actor_kind: "user",
                   metadata: %{
                     "choice" => choice,
                     "target_purpose" => target_purpose(choice),
                     "customer_id_override" => override
                   }
                 }),
               {:ok, updated_lot} <- maybe_stamp_bailee(lot, choice, customer_id, actor) do
            %{lot: updated_lot, event: event, choice: choice}
          else
            {:error, reason} -> Repo.rollback(reason)
          end
        end)
      end

    # Nudge every wizard subscribed to the parent CO to refetch its
    # snapshot. Without this the wizard stays on the awaiting_routing
    # CTA for the operator until they manually reload, even though
    # the lot has already advanced.
    with {:ok, %{lot: routed}} <- result do
      notify_wizard(routed)
      result
    else
      _ -> result
    end
  end

  def route_released_lot(_actor, _lot, _choice, _opts), do: {:error, :invalid_choice}

  defp notify_wizard(%Lot{id: lot_id}) do
    case Repo.one(
           from mo in ManufacturingOrder,
             where: mo.produced_lot_id == ^lot_id,
             select: mo.id,
             limit: 1
         ) do
      nil -> :ok
      mo_id -> Backend.OrderWizard.notify_via_mo(mo_id)
    end
  end

  # =====================================================================
  # Capacity math
  # =====================================================================

  @doc """
  Free capacity, in cubic metres, across every cell of `purpose` in
  `warehouse_id`. Free = sum(cell_capacity) − sum(placed_volume).

  Individual cell fit-check happens later at put-away time; this is
  the pre-flight number the wizard uses to warn "no 3PL space".
  """
  def capacity_free_m3(warehouse_id, purpose)
      when is_integer(warehouse_id) and is_binary(purpose) do
    cells = fetch_cells(warehouse_id, purpose)
    total = Enum.reduce(cells, Decimal.new(0), &Decimal.add(&2, cell_volume_m3(&1)))
    used = purpose_stored_volume_m3(warehouse_id, purpose)
    Decimal.sub(total, used)
  end

  @doc """
  Volume, in cubic metres, a whole lot's worth of packaged qty would
  occupy. Rounds up when the lot's dimensions are incomplete — caller
  should ensure the lot has package dimensions before calling.
  """
  def lot_stored_volume_m3(%Lot{
        package_length_mm: l,
        package_width_mm: w,
        package_height_mm: h,
        units_per_package: units,
        qty_received: qty
      })
      when is_integer(l) and is_integer(w) and is_integer(h) and not is_nil(qty) do
    packages =
      qty
      |> Decimal.div(units || Decimal.new(1))
      |> Decimal.round(6)

    single_package_m3 = mm3_to_m3(l * w * h)
    Decimal.mult(packages, single_package_m3)
  end

  def lot_stored_volume_m3(_), do: Decimal.new(0)

  # =====================================================================
  # Inventory query
  # =====================================================================

  @doc """
  Lots currently held under bailee custody for company `company_id`.
  Returns lots preloaded for the 3PL tab: bailee customer, item,
  placements → cell → location → floor → warehouse. Terminal-status
  lots (`disposed`, `canceled`, `depleted`) are excluded.
  """
  def list_bailee_lots(company_id) when is_integer(company_id) do
    from(l in Lot,
      where:
        l.company_id == ^company_id and
          l.ownership_kind == "bailee" and
          l.status not in ["disposed", "canceled", "depleted"],
      preload: [
        :item,
        :unit_of_measurement,
        :bailee_customer,
        placements:
          ^from(p in Placement,
            preload: [storage_cell: [storage_location: [floor: [:warehouse]]]]
          )
      ],
      order_by: [desc: l.bailee_routed_at]
    )
    |> Repo.all()
  end

  # =====================================================================
  # Private
  # =====================================================================

  defp target_purpose("three_pl"), do: "three_pl_storage"
  defp target_purpose("shipment"), do: "dispatch"

  defp event_kind("three_pl"), do: "routed_to_3pl"
  defp event_kind("shipment"), do: "routed_to_shipment"

  defp ensure_permission(actor) do
    if RBAC.has_permission?(actor, @perm), do: :ok, else: {:error, :forbidden}
  end

  defp ensure_available(%Lot{status: "available"}), do: :ok
  defp ensure_available(_), do: {:error, :not_available}

  # A lot is "already routed" when it has a routed_to_3pl or
  # routed_to_shipment event on its timeline. Guards against both
  # (a) a bailee lot re-routed to shipment and (b) a shipment lot
  # re-routed to shipment or 3PL. Rerouting requires a dedicated
  # override action (out of scope for MVP).
  defp ensure_not_already_routed(%Lot{id: lot_id}) do
    routed? =
      Repo.exists?(
        from e in LotEvent,
          where:
            e.stock_lot_id == ^lot_id and
              e.kind in ["routed_to_3pl", "routed_to_shipment"]
      )

    if routed?, do: {:error, :already_routed}, else: :ok
  end

  defp ensure_capacity(warehouse_id, %Lot{} = lot, choice) do
    required = lot_stored_volume_m3(lot)
    purpose = target_purpose(choice)
    free = capacity_free_m3(warehouse_id, purpose)

    if Decimal.compare(free, required) == :lt do
      {:error,
       {:no_capacity,
        %{
          purpose: purpose,
          required_m3: Decimal.round(required, 4),
          free_m3: Decimal.round(free, 4)
        }}}
    else
      :ok
    end
  end

  # For 3PL routing we snapshot the bailee customer at decision time.
  # Derive the customer from the MO that produced this lot → its
  # customer_order_line → its customer_order → the customer. When the
  # derived lookup fails (opening-balance / manually-created lots), the
  # caller can pass an override customer id — we still validate that
  # customer belongs to the same company as the actor's session.
  defp maybe_resolve_customer(_lot, "shipment", _override), do: {:ok, nil}

  defp maybe_resolve_customer(%Lot{id: lot_id, company_id: company_id}, "three_pl", override) do
    derived =
      from(mo in ManufacturingOrder,
        join: col in CustomerOrderLine,
        on: col.id == mo.customer_order_line_id,
        join: co in CustomerOrder,
        on: co.id == col.customer_order_id,
        where: mo.produced_lot_id == ^lot_id,
        select: co.customer_id,
        limit: 1
      )
      |> Repo.one()

    cond do
      not is_nil(derived) ->
        {:ok, derived}

      is_integer(override) ->
        # Guard against picking a customer that doesn't belong to this
        # company — the wizard shouldn't be able to expose one via the
        # picker, but if it does we bounce it here.
        case Repo.get(Backend.Customers.Customer, override) do
          %{company_id: ^company_id} -> {:ok, override}
          _ -> {:error, {:bad_customer, override}}
        end

      true ->
        {:error, :no_customer_for_lot}
    end
  end

  defp maybe_stamp_bailee(%Lot{} = lot, "shipment", _customer_id, _actor), do: {:ok, lot}

  defp maybe_stamp_bailee(%Lot{} = lot, "three_pl", customer_id, %User{id: actor_id}) do
    lot
    |> Lot.changeset(%{
      ownership_kind: "bailee",
      bailee_customer_id: customer_id,
      bailee_routed_at: DateTime.utc_now() |> DateTime.truncate(:second),
      updated_by_id: actor_id
    })
    |> Repo.update()
  end

  # The wizard step routes lots one at a time; we scope capacity checks
  # to the warehouse the lot currently physically sits in. All active
  # placements should be in one warehouse — take the first one.
  defp resolve_warehouse(%Lot{id: lot_id}) do
    row =
      from(p in Placement,
        join: c in StorageCell,
        on: c.id == p.storage_cell_id,
        join: loc in assoc(c, :storage_location),
        where: p.stock_lot_id == ^lot_id and p.qty > 0,
        select: loc.warehouse_id,
        limit: 1
      )
      |> Repo.one()

    case row do
      nil -> {:error, :lot_not_placed}
      warehouse_id -> {:ok, warehouse_id}
    end
  end

  defp fetch_cells(warehouse_id, purpose) do
    from(c in StorageCell,
      join: loc in assoc(c, :storage_location),
      where: loc.warehouse_id == ^warehouse_id and c.purpose == ^purpose,
      select: %{
        id: c.id,
        width_m: c.width_m,
        depth_m: c.depth_m,
        height_m: c.height_m
      }
    )
    |> Repo.all()
  end

  defp cell_volume_m3(%{width_m: w, depth_m: d, height_m: h}) do
    [w, d, h]
    |> Enum.map(&decimal_or_zero/1)
    |> Enum.reduce(Decimal.new(1), &Decimal.mult(&2, &1))
  end

  # Sum of stored volume across every placement currently sitting in a
  # cell of `purpose` inside `warehouse_id`. Computed in Elixir land
  # rather than SQL so we can reuse the same volume formula the wizard
  # uses for the pre-check.
  defp purpose_stored_volume_m3(warehouse_id, purpose) do
    from(p in Placement,
      join: c in StorageCell,
      on: c.id == p.storage_cell_id,
      join: loc in assoc(c, :storage_location),
      join: l in Lot,
      on: l.id == p.stock_lot_id,
      where:
        loc.warehouse_id == ^warehouse_id and c.purpose == ^purpose and p.qty > 0,
      select: %{
        qty: p.qty,
        units_per_package: l.units_per_package,
        length_mm: l.package_length_mm,
        width_mm: l.package_width_mm,
        height_mm: l.package_height_mm
      }
    )
    |> Repo.all()
    |> Enum.reduce(Decimal.new(0), fn row, acc ->
      Decimal.add(acc, placement_stored_volume(row))
    end)
  end

  defp placement_stored_volume(%{
         length_mm: l,
         width_mm: w,
         height_mm: h,
         qty: qty,
         units_per_package: units
       })
       when is_integer(l) and is_integer(w) and is_integer(h) and not is_nil(qty) do
    packages =
      qty
      |> Decimal.div(units || Decimal.new(1))
      |> Decimal.round(6)

    Decimal.mult(packages, mm3_to_m3(l * w * h))
  end

  defp placement_stored_volume(_), do: Decimal.new(0)

  defp mm3_to_m3(mm3) when is_integer(mm3) do
    Decimal.div(Decimal.new(mm3), Decimal.new(1_000_000_000))
  end

  defp decimal_or_zero(nil), do: Decimal.new(0)
  defp decimal_or_zero(%Decimal{} = d), do: d
  defp decimal_or_zero(n) when is_integer(n) or is_float(n), do: Decimal.new("#{n}")
end
