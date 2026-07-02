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
  alias Backend.Stock
  alias Backend.Stock.{Lifecycle, Lot, LotEvent, Placement}
  alias Backend.ThreePL.Dispatch
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
  # Outbound dispatch (partial-lot)
  # =====================================================================

  @doc """
  Send `qty` of a bailee lot out the door. Enforces:

    * actor holds `production.final_release`
    * lot is `ownership_kind = "bailee"` (own stock ships via the
      standard move flow, not this partial-lot procedure)
    * `qty > 0` AND `qty <= source placement qty` in the lot's
      current `three_pl_storage` cell
    * warehouse has at least one `dispatch` cell to receive the qty

  Records:
    * a `three_pl_dispatches` row with qty + evidence (photo, optional
      reference / notes) + actor + timestamp — the audit trail we can
      show a customer or auditor asking "when did I get X"
    * a `Backend.Stock.Movement` from the three_pl_storage cell to the
      target dispatch cell for the same qty. The move + the audit row
      commit or roll back as one.

  `attrs`:

      %{
        "lot_uuid" => "<uuid>",
        "qty" => decimal-parseable,
        "reference" => nil | binary,  # carrier waybill, customer PO ref
        "notes" => nil | binary,
        "photo_url" => nil | binary   # evidence link (required in the FE)
      }

  Returns `{:ok, %{dispatch: dispatch, lot: lot}}` on success or
  `{:error, reason}` where reason is one of `:forbidden`,
  `:not_bailee`, `:bad_qty`, `:no_bailee_placement`,
  `:insufficient_qty`, `:no_dispatch_cell`, or an
  `%Ecto.Changeset{}` / raw context error tuple.
  """
  def dispatch(%User{} = actor, attrs) when is_map(attrs) do
    with :ok <- ensure_permission(actor),
         {:ok, lot_uuid} <- fetch_key(attrs, "lot_uuid"),
         {:ok, lot} <- fetch_bailee_lot(actor.company_id, lot_uuid),
         {:ok, qty} <- parse_qty(Map.get(attrs, "qty")),
         {:ok, from_placement} <- find_bailee_placement(lot),
         :ok <- ensure_qty_available(from_placement, qty),
         {:ok, to_cell} <- find_dispatch_cell(from_placement) do
      Repo.transaction(fn ->
        move_attrs = %{
          "to_cell_uuid" => to_cell.uuid,
          "from_cell_uuid" => from_placement.storage_cell.uuid,
          "qty" => Decimal.to_string(qty),
          "photo_url" => Map.get(attrs, "photo_url"),
          "reason" => "3PL dispatch"
        }

        case Stock.move_placement(actor, lot.uuid, move_attrs) do
          {:ok, _} ->
            row_attrs = %{
              company_id: actor.company_id,
              stock_lot_id: lot.id,
              qty: qty,
              reference: Map.get(attrs, "reference"),
              notes: Map.get(attrs, "notes"),
              photo_url: Map.get(attrs, "photo_url"),
              dispatched_by_id: actor.id,
              dispatched_at: DateTime.utc_now() |> DateTime.truncate(:second)
            }

            case %Dispatch{} |> Dispatch.changeset(row_attrs) |> Repo.insert() do
              {:ok, row} -> %{dispatch: row, lot: Repo.reload!(lot)}
              {:error, cs} -> Repo.rollback(cs)
            end

          {:error, reason} ->
            Repo.rollback(reason)
        end
      end)
    end
  end

  @doc """
  Every dispatch on `lot`, newest first. Used by the 3PL tab's lot
  drawer + downstream reporting.
  """
  def list_dispatches(%Lot{id: lot_id}) do
    import Ecto.Query

    from(d in Dispatch,
      where: d.stock_lot_id == ^lot_id,
      order_by: [desc: d.dispatched_at, desc: d.id],
      preload: [:dispatched_by]
    )
    |> Repo.all()
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
  occupy — based on `qty_received`. Used by the wizard's pre-check to
  decide whether a target purpose has capacity for the entire lot.
  """
  def lot_stored_volume_m3(%Lot{
        package_length_mm: l,
        package_width_mm: w,
        package_height_mm: h,
        units_per_package: units,
        qty_received: qty
      })
      when is_integer(l) and is_integer(w) and is_integer(h) and not is_nil(qty) do
    packages_volume(l, w, h, qty, units)
  end

  def lot_stored_volume_m3(_), do: Decimal.new(0)

  @doc """
  Volume currently held in bailee custody — sum of placement qty in
  `three_pl_storage` cells × package dimensions. Drifts down as
  dispatches consume placement qty. Used by the 3PL tab so the
  displayed volume tracks what's really on the floor after partial
  outbound sends.
  """
  def lot_held_volume_m3(%Lot{placements: placements} = lot)
      when is_list(placements) do
    held_qty =
      placements
      |> Enum.filter(fn p ->
        p.storage_cell &&
          p.storage_cell.purpose == "three_pl_storage" &&
          p.qty &&
          Decimal.compare(p.qty, Decimal.new(0)) == :gt
      end)
      |> Enum.reduce(Decimal.new(0), &Decimal.add(&2, &1.qty))

    l = lot.package_length_mm
    w = lot.package_width_mm
    h = lot.package_height_mm

    if is_integer(l) and is_integer(w) and is_integer(h) do
      packages_volume(l, w, h, held_qty, lot.units_per_package)
    else
      Decimal.new(0)
    end
  end

  def lot_held_volume_m3(_), do: Decimal.new(0)

  defp packages_volume(l, w, h, qty, units) do
    packages =
      qty
      |> Decimal.div(units || Decimal.new(1))
      |> Decimal.round(6)

    single_package_m3 = mm3_to_m3(l * w * h)
    Decimal.mult(packages, single_package_m3)
  end

  # =====================================================================
  # Inventory query
  # =====================================================================

  @doc """
  Charge accrued so far on `lot` at `rate` (currency-agnostic decimal
  in company base currency, per m³ per day). Returns `Decimal.new(0)`
  when the rate is nil, when the lot has no routing timestamp, or
  when dimensions are missing (any of the three breaks the formula).
  """
  def accrued_charge(%Lot{} = lot, rate)
      when not is_nil(rate) do
    routed_at = lot.bailee_routed_at

    days =
      case routed_at do
        %DateTime{} ->
          seconds = DateTime.diff(DateTime.utc_now(), routed_at, :second)
          max(div(seconds, 86_400), 0)

        _ ->
          0
      end

    # Bill against currently-held volume — after a partial dispatch
    # the customer stops paying for the qty that's left the shelf.
    volume = lot_held_volume_m3(lot)

    Decimal.new(days)
    |> Decimal.mult(volume)
    |> Decimal.mult(rate)
  end

  def accrued_charge(_lot, _rate), do: Decimal.new(0)

  @doc """
  Full bailee-lot bundle for the /three-pl/:lot_uuid detail page —
  the lot itself, every dispatch we've recorded (newest first) with
  actor + evidence, and the Positive Release paperwork attached at
  release time (CoA, BMR, micro, label proof, retention sample).
  Returns `nil` when the lot isn't in bailee custody so a caller
  can 404 the operator instead of showing a blank page.
  """
  def get_bailee_lot_detail(company_id, lot_uuid)
      when is_integer(company_id) and is_binary(lot_uuid) do
    case Repo.get_by(Lot, uuid: lot_uuid, company_id: company_id) do
      %Lot{ownership_kind: "bailee"} = lot ->
        preloaded =
          Repo.preload(lot, [
            :item,
            :unit_of_measurement,
            :bailee_customer,
            placements: [storage_cell: [storage_location: [floor: [:warehouse]]]]
          ])

        %{
          lot: preloaded,
          dispatches: list_dispatches(preloaded),
          release: fetch_release_bundle(preloaded)
        }

      _ ->
        nil
    end
  end

  # Positive Release row + files for this lot (BRCGS Issue 9 § 5.6
  # paperwork). Nil when the lot came into bailee custody outside
  # the release ceremony (opening balance / manual receive routed
  # to 3PL manually).
  defp fetch_release_bundle(%Lot{id: lot_id}) do
    row =
      Repo.one(
        from r in Backend.Production.FinalRelease,
          where: r.stock_lot_id == ^lot_id,
          preload: [:files, :releaser, :approver, :finalized_by]
      )

    row
  end

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

  defp fetch_key(attrs, key) do
    case Map.get(attrs, key) do
      v when is_binary(v) and v != "" -> {:ok, v}
      _ -> {:error, {:missing_key, key}}
    end
  end

  defp fetch_bailee_lot(company_id, lot_uuid) do
    case Repo.get_by(Lot, uuid: lot_uuid) do
      %Lot{company_id: ^company_id, ownership_kind: "bailee"} = lot ->
        {:ok,
         Repo.preload(lot,
           placements: [storage_cell: [storage_location: [:floor]]]
         )}

      %Lot{} ->
        {:error, :not_bailee}

      _ ->
        {:error, :lot_not_found}
    end
  end

  defp parse_qty(nil), do: {:error, :bad_qty}
  defp parse_qty(%Decimal{} = d), do: check_positive(d)

  defp parse_qty(v) when is_binary(v) do
    case Decimal.new(v) do
      %Decimal{} = d -> check_positive(d)
    end
  rescue
    _ -> {:error, :bad_qty}
  end

  defp parse_qty(v) when is_integer(v) or is_float(v),
    do: check_positive(Decimal.new("#{v}"))

  defp parse_qty(_), do: {:error, :bad_qty}

  defp check_positive(%Decimal{} = d) do
    if Decimal.compare(d, Decimal.new(0)) == :gt, do: {:ok, d}, else: {:error, :bad_qty}
  end

  defp find_bailee_placement(%Lot{placements: placements}) do
    match =
      Enum.find(placements, fn p ->
        p.qty && Decimal.compare(p.qty, Decimal.new(0)) == :gt and
          p.storage_cell &&
          p.storage_cell.purpose == "three_pl_storage"
      end)

    case match do
      %Placement{} = p -> {:ok, p}
      _ -> {:error, :no_bailee_placement}
    end
  end

  defp ensure_qty_available(%Placement{qty: available}, qty) do
    if Decimal.compare(available, qty) == :lt do
      {:error, :insufficient_qty}
    else
      :ok
    end
  end

  # Pick any dispatch cell in the same warehouse as the source
  # placement. The mobile move flow does per-cell fit ranking; here
  # we just need SOME dispatch cell to hand off to. If none exists,
  # dispatch fails so the operator adds one before continuing.
  defp find_dispatch_cell(%Placement{storage_cell: cell}) do
    warehouse_id =
      cell.storage_location.floor && cell.storage_location.floor.warehouse_id

    row =
      from(c in StorageCell,
        join: loc in assoc(c, :storage_location),
        where:
          loc.warehouse_id == ^warehouse_id and
            c.purpose == "dispatch",
        preload: [storage_location: [:floor]],
        limit: 1
      )
      |> Repo.one()

    case row do
      %StorageCell{} = r -> {:ok, r}
      nil -> {:error, :no_dispatch_cell}
    end
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
