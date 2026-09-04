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
  alias Backend.Audit
  alias Backend.Repo
  alias Backend.Stock
  alias Backend.Stock.{Lifecycle, Lot, LotEvent, Placement}
  alias Backend.ThreePL.Dispatch
  alias Backend.Warehouses.StorageCell

  # Routing itself rides `production.final_release` — it's part of
  # the release ceremony (whoever signs picks the route). The dispatch
  # half of this module (request + complete) uses distinct perms so
  # the desktop shipping coordinator and the mobile warehouse operator
  # can be different humans with different capabilities.
  @perm_route "production.final_release"
  @perm_dispatch_request "three_pl.dispatch_request"
  @perm_dispatch_execute "three_pl.dispatch_execute"

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
    lot_before = lot_routing_snapshot(lot)

    result =
      with :ok <- ensure_permission_route(actor),
           :ok <- ensure_available(lot),
           :ok <- ensure_not_already_routed(lot),
           :ok <- ensure_choice_allowed_for_lot(lot, choice),
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
      # Field-level audit on the LOT (ownership_kind + bailee snapshot).
      # The LotEvent lifecycle log already captured the semantic
      # routed_to_3pl / routed_to_shipment event; this one shows the
      # column-level diff on the stock_lot audit rail.
      Audit.record_updated(
        actor,
        "stock_lot",
        routed,
        lot_before,
        lot_routing_snapshot(routed)
      )

      # Custom-formulation COs carry a ``co_routing_request`` state
      # machine that the customer + PSP team can advance in parallel.
      # When the OPERATOR routes a lot directly via the per-lot
      # picker, walk to the CO and if every produced lot is now
      # routed the same way, flip the request row to ``applied_*``.
      # Idempotent: no-op on standard commercial COs and on partial
      # progress (some lots still awaiting routing).
      Backend.ThreePL.Requests.sync_state_after_per_lot_routing(
        actor,
        routed,
        choice
      )

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
  Desktop step 1 — queue a dispatch request. Records qty + optional
  reference / notes, flags `status = "pending"`, stamps the requester.
  NO physical Stock.Movement fires here; that happens on mobile in
  `complete_dispatch/3` when the warehouse picker executes the move.

  Enforces:

    * actor holds `production.final_release`
    * lot is `ownership_kind = "bailee"`
    * `qty > 0` AND `qty <=` currently-held bailee qty (including
      any qty already claimed by pending requests — one dispatch
      can't over-book what another has already asked for)

  `attrs`:

      %{
        "lot_uuid" => "<uuid>",
        "qty" => decimal-parseable,
        "reference" => nil | binary,
        "notes" => nil | binary
      }

  Returns `{:ok, %Dispatch{}}` or `{:error, reason}` — `:forbidden`,
  `:not_bailee`, `:bad_qty`, `:no_bailee_placement`,
  `:insufficient_qty`, `{:missing_key, key}`, or an
  `%Ecto.Changeset{}`.
  """
  def request_dispatch(%User{} = actor, attrs) when is_map(attrs) do
    with :ok <- ensure_permission_dispatch_request(actor),
         {:ok, lot_uuid} <- fetch_key(attrs, "lot_uuid"),
         {:ok, lot} <- fetch_bailee_lot(actor.company_id, lot_uuid),
         {:ok, qty} <- parse_qty(Map.get(attrs, "qty")),
         :ok <- ensure_bailee_qty_available(lot, qty) do
      %Dispatch{}
      |> Dispatch.request_changeset(%{
        company_id: actor.company_id,
        stock_lot_id: lot.id,
        qty: qty,
        reference: Map.get(attrs, "reference"),
        notes: Map.get(attrs, "notes"),
        status: "pending",
        source: "staff",
        requested_by_id: actor.id,
        requested_at: DateTime.utc_now() |> DateTime.truncate(:second)
      })
      |> Repo.insert()
      |> tap_audit_created_dispatch(actor)
    end
  end

  @doc """
  Portal-triggered dispatch request — the customer clicked "Request
  dispatch" on their /portal/warehouse page. Same effect as
  :func:`request_dispatch/2` (creates a `pending` row that a
  warehouse picker will complete on mobile), but:

    * no PSP `%User{}` actor — the request came from a customer
    * `source = "portal"` so the mobile picker queue can badge the
      row + downstream Phase 3 webhook logic can find it
    * lot ownership is enforced against the ``customer_uuid`` on the
      payload — a leaked lot_uuid to a non-owner surfaces as
      `:not_owner`, not as a successful cross-customer dispatch
    * `external_reference` is optional (Phase 2 leaves it nil;
      Phase 3's Shopify webhook fills it with the Shopify order id)

  `attrs`:

      %{
        "company_id" => integer,         # asserted by caller
        "customer_uuid" => "<uuid>",
        "lot_uuid" => "<uuid>",
        "qty" => decimal-parseable,
        "reference" => nil | binary,
        "notes" => nil | binary,
        "source" => "portal" | "shopify_webhook" | "custom_api",
        "external_reference" => nil | binary
      }

  Returns `{:ok, %Dispatch{}}` or `{:error, reason}` — `:not_bailee`,
  `:not_owner`, `:bad_qty`, `:no_bailee_placement`,
  `:insufficient_qty`, `{:missing_key, key}`, or an
  `%Ecto.Changeset{}`. Audit rail records the action against the
  integration token's actor identity (captured at the controller
  layer, not here).
  """
  def request_customer_dispatch(attrs) when is_map(attrs) do
    with {:ok, company_id} <- fetch_int_key(attrs, "company_id"),
         {:ok, customer_uuid} <- fetch_key(attrs, "customer_uuid"),
         {:ok, lot_uuid} <- fetch_key(attrs, "lot_uuid"),
         {:ok, lot} <- fetch_bailee_lot(company_id, lot_uuid),
         :ok <- ensure_lot_belongs_to_customer(lot, company_id, customer_uuid),
         {:ok, qty} <- parse_qty(Map.get(attrs, "qty")),
         :ok <- ensure_bailee_qty_available(lot, qty) do
      source = source_or_default(Map.get(attrs, "source"))

      %Dispatch{}
      |> Dispatch.request_changeset(%{
        company_id: company_id,
        stock_lot_id: lot.id,
        qty: qty,
        reference: Map.get(attrs, "reference"),
        notes: Map.get(attrs, "notes"),
        status: "pending",
        source: source,
        external_reference: Map.get(attrs, "external_reference"),
        # No PSP User actor for portal-triggered requests. The
        # existing changeset now allows a nil FK; audit trail
        # attributes the row via the integration token's identity
        # captured at the controller boundary.
        requested_by_id: nil,
        requested_at: DateTime.utc_now() |> DateTime.truncate(:second),
        # Customer-provided delivery target from the portal dialog.
        # Nil-safe — desktop-typed requests skip these fields and
        # the shipment falls back to the CO / customer defaults on
        # ``create_from_lot``.
        ship_to_name: Map.get(attrs, "ship_to_name"),
        ship_to_address: Map.get(attrs, "ship_to_address"),
        ship_to_country: Map.get(attrs, "ship_to_country")
      })
      |> Repo.insert()
    end
  end

  defp fetch_int_key(attrs, key) do
    case Map.get(attrs, key) do
      v when is_integer(v) -> {:ok, v}
      _ -> {:error, {:missing_key, key}}
    end
  end

  defp ensure_lot_belongs_to_customer(lot, company_id, customer_uuid)
       when is_binary(customer_uuid) do
    # Same dual-identity trap as
    # :func:`list_bailee_lots_for_customer/2`: NPD-side callers
    # (portal → Django proxy) pass ``Customer.id`` from Django, which
    # PSP stores as ``npd_source_uuid`` via the sync-time
    # ``resolve_customer`` dedupe. Match on either column so a portal
    # dispatch request never falsely reports ``:not_owner`` when the
    # lot is genuinely held for the caller's customer row.
    resolved =
      Repo.get_by(Backend.Customers.Customer,
        company_id: company_id,
        uuid: customer_uuid
      ) ||
        Repo.get_by(Backend.Customers.Customer,
          company_id: company_id,
          npd_source_uuid: customer_uuid
        )

    case resolved do
      %Backend.Customers.Customer{id: cid} when cid == lot.bailee_customer_id ->
        :ok

      _ ->
        {:error, :not_owner}
    end
  rescue
    Ecto.Query.CastError -> {:error, :not_owner}
  end

  defp source_or_default(source) when is_binary(source) do
    if source in Dispatch.sources(), do: source, else: "portal"
  end

  defp source_or_default(_), do: "portal"

  defp tap_audit_created_dispatch({:ok, %Dispatch{} = row}, actor) do
    Audit.record_created(actor, "three_pl_dispatch", row, dispatch_snapshot(row))
    {:ok, row}
  end

  defp tap_audit_created_dispatch(other, _actor), do: other

  defp tap_audit_updated_dispatch({:ok, %Dispatch{} = row}, actor, before_state) do
    Audit.record_updated(
      actor,
      "three_pl_dispatch",
      row,
      before_state,
      dispatch_snapshot(row)
    )

    {:ok, row}
  end

  defp tap_audit_updated_dispatch(other, _actor, _before), do: other

  # Snapshot the fields the audit rail cares about. Placement pointers
  # + cell relationships are captured via the Stock.Movement audit
  # trail, so the dispatch snapshot itself stays tight.
  defp dispatch_snapshot(%Dispatch{} = row) do
    %{
      status: row.status,
      qty: row.qty,
      reference: row.reference,
      notes: row.notes,
      photo_url: row.photo_url,
      requested_at: row.requested_at,
      requested_by_id: row.requested_by_id,
      dispatched_at: row.dispatched_at,
      dispatched_by_id: row.dispatched_by_id
    }
  end

  # Snapshot the fields the routing action mutates on the lot itself.
  # Placement + Stock.Movement mutations already emit their own audit
  # rows via the Stock context.
  defp lot_routing_snapshot(%Lot{} = lot) do
    %{
      ownership_kind: lot.ownership_kind,
      bailee_customer_id: lot.bailee_customer_id,
      bailee_routed_at: lot.bailee_routed_at
    }
  end

  @doc """
  Mobile step 2 — execute the physical dispatch. Called by the
  warehouse picker after they've scanned the source three_pl_storage
  cell, scanned the lot, walked the qty to the shipping bay, scanned
  the destination dispatch cell, and captured a photo.

  Runs inside a Repo.transaction so the Stock.Movement + placement
  updates + dispatch row completion commit atomically. Rolls back if
  any step fails.

  `attrs`:

      %{
        "to_cell_uuid" => "<dispatch cell uuid>",
        "photo_url" => "<evidence URL>"
      }

  Returns `{:ok, %{dispatch: dispatch, lot: lot}}` or `{:error, ...}`.
  Errors: `:forbidden`, `:not_pending`, `:not_bailee`,
  `:no_bailee_placement`, `:insufficient_qty`, `:bad_dispatch_cell`
  (destination isn't a dispatch cell in the same warehouse), or an
  `%Ecto.Changeset{}` from the move.
  """
  def complete_dispatch(%User{} = actor, dispatch_uuid, attrs)
      when is_binary(dispatch_uuid) and is_map(attrs) do
    with :ok <- ensure_permission_dispatch_execute(actor),
         {:ok, dispatch, lot} <- fetch_pending_dispatch(actor.company_id, dispatch_uuid),
         {:ok, from_placement} <- find_bailee_placement(lot),
         :ok <- ensure_qty_available(from_placement, dispatch.qty),
         {:ok, to_cell} <- fetch_dispatch_cell(actor.company_id, attrs["to_cell_uuid"], from_placement) do
      dispatch_before = dispatch_snapshot(dispatch)

      Repo.transaction(fn ->
        move_attrs = %{
          "to_cell_uuid" => to_cell.uuid,
          "from_cell_uuid" => from_placement.storage_cell.uuid,
          "qty" => Decimal.to_string(dispatch.qty),
          "photo_url" => Map.get(attrs, "photo_url"),
          "reason" => "3PL dispatch"
        }

        case Stock.move_placement(actor, lot.uuid, move_attrs) do
          {:ok, _} ->
            now = DateTime.utc_now() |> DateTime.truncate(:second)

            with {:ok, updated} <-
                   dispatch
                   |> Dispatch.completion_changeset(%{
                     status: "completed",
                     photo_url: Map.get(attrs, "photo_url"),
                     dispatched_by_id: actor.id,
                     dispatched_at: now,
                     # Remember where the picker took this from so a
                     # subsequent cancel-and-return knows the target
                     # for the walk-back without guessing.
                     return_target_cell_id: from_placement.storage_cell.id
                   })
                   |> Repo.update()
                   |> tap_audit_updated_dispatch(actor, dispatch_before),
                 :ok <- spawn_outbound_shipment(actor, lot, dispatch) do
              %{dispatch: updated, lot: Repo.reload!(lot)}
            else
              {:error, cs} -> Repo.rollback(cs)
            end

          {:error, reason} ->
            Repo.rollback(reason)
        end
      end)
    end
  end

  # 3PL dispatch handoff → standard outbound shipment flow. After the
  # picker has physically walked the qty into a `dispatch` cell (via
  # ``Stock.move_placement`` above), spawn a draft Shipment against
  # the lot so the rest of the outbound paperwork (paperwork tab
  # → pickup tab → confirm tab on the mobile hub) reuses the same
  # code path direct-ship orders travel. The shipment lands in
  # ``draft`` so the operator explicitly reviews the shipping form
  # (recipient, address, country, planned ship date) before marking
  # Ready — the paperwork step is an explicit tab on the mobile hub,
  # not something auto-skipped.
  #
  # ``:already_open`` isn't an error: partial fulfilments against a
  # single lot are a legitimate flow (customer queues 500 today +
  # 300 tomorrow), and the second pick lands into the existing draft.
  # ``Backend.Shipments.create_from_lot/2`` will fold future qty into
  # the existing draft via its own re-derive on Ready — no data loss.
  defp spawn_outbound_shipment(%User{} = actor, %Lot{uuid: lot_uuid}, %Dispatch{} = dispatch) do
    case Backend.Shipments.create_from_lot(actor, lot_uuid) do
      {:ok, shipment} ->
        # Customer-supplied ship-to details from the portal
        # ``Request dispatch`` dialog override the CO / customer
        # fallback that ``create_from_lot`` prefilled. Empty /
        # nil fields on the dispatch fall through untouched.
        _ = apply_dispatch_ship_to_overrides(actor, shipment, dispatch)
        :ok

      {:error, :already_open} ->
        :ok

      {:error, _reason} = err ->
        err
    end
  end

  defp apply_dispatch_ship_to_overrides(%User{} = actor, shipment, %Dispatch{} = d) do
    overrides =
      %{}
      |> maybe_put(:recipient_name, d.ship_to_name)
      |> maybe_put(:ship_to_address, d.ship_to_address)
      |> maybe_put(:ship_to_country, d.ship_to_country)

    if map_size(overrides) == 0 do
      :ok
    else
      case Backend.Shipments.update(actor, shipment, overrides) do
        {:ok, _} -> :ok
        # Update failures are non-fatal: the shipment still exists in
        # draft with the CO / customer defaults, and the mobile
        # Paperwork form lets the operator amend by hand.
        {:error, _} -> :ok
      end
    end
  end

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, _key, ""), do: map
  defp maybe_put(map, key, val) when is_binary(val), do: Map.put(map, key, val)
  defp maybe_put(map, _key, _), do: map

  @doc """
  Every dispatch on `lot`, newest first. Includes pending, completed,
  and cancelled — the tab renders them in separate sections.
  """
  def list_dispatches(%Lot{id: lot_id}) do
    import Ecto.Query

    from(d in Dispatch,
      where: d.stock_lot_id == ^lot_id,
      order_by: [desc: d.requested_at, desc: d.id],
      preload: [:requested_by, :dispatched_by]
    )
    |> Repo.all()
  end

  @doc """
  Pending dispatches across the whole company — feeds the mobile
  picker queue. Preloaded so the FE renders lot + customer + volume
  without a second round-trip.
  """
  def list_pending_dispatches(company_id) when is_integer(company_id) do
    import Ecto.Query

    from(d in Dispatch,
      where: d.company_id == ^company_id and d.status == "pending",
      order_by: [asc: d.requested_at, asc: d.id],
      preload: [
        :requested_by,
        stock_lot: [
          :item,
          :unit_of_measurement,
          :bailee_customer,
          placements: [storage_cell: [storage_location: [floor: [:warehouse]]]]
        ]
      ]
    )
    |> Repo.all()
  end

  @doc "Look up a single pending dispatch by uuid, scoped to company."
  def get_pending_dispatch(company_id, dispatch_uuid)
      when is_integer(company_id) and is_binary(dispatch_uuid) do
    import Ecto.Query

    from(d in Dispatch,
      where:
        d.company_id == ^company_id and
          d.uuid == ^dispatch_uuid and
          d.status == "pending",
      preload: [
        :requested_by,
        stock_lot: [
          :item,
          :unit_of_measurement,
          :bailee_customer,
          placements: [storage_cell: [storage_location: [floor: [:warehouse]]]]
        ]
      ]
    )
    |> Repo.one()
  end

  @doc """
  Cancel a pending dispatch — desktop only. Just flips status to
  `cancelled` so the picker queue drops it. Rejects if the row has
  already been completed.
  """
  def cancel_dispatch(%User{} = actor, dispatch_uuid) when is_binary(dispatch_uuid) do
    with :ok <- ensure_permission_dispatch_request(actor),
         {:ok, dispatch, _lot} <- fetch_pending_dispatch(actor.company_id, dispatch_uuid) do
      before_state = dispatch_snapshot(dispatch)

      dispatch
      |> Dispatch.completion_changeset(%{
        status: "cancelled",
        dispatched_by_id: actor.id,
        dispatched_at: DateTime.utc_now() |> DateTime.truncate(:second)
      })
      |> Repo.update()
      |> tap_audit_updated_dispatch(actor, before_state)
    end
  end

  @doc """
  Cancel-and-return handoff for a bailee-flow Shipment. Fires when
  the operator taps Cancel on a Paperwork / Pickup row — the goods
  are still on the dispatch shelf and owe a walk back to bailee
  custody.

  Steps in one transaction:

    1. Look up the completed Dispatch that spawned this Shipment
       (matched by ``stock_lot_id`` — bailee lots ship 1:1 with a
       Dispatch, and the completed row is the latest).
    2. Cancel the Shipment via ``Backend.Shipments.cancel/3``.
    3. Flip the Dispatch to ``return_pending`` so the mobile
       Return tab surfaces the walk-back task.

  Returns ``{:ok, %{shipment: cancelled_shipment, dispatch: dispatch}}``
  or ``{:error, reason}``. ``:no_bailee_dispatch`` when the lot's
  ownership_kind isn't bailee (never came from a 3PL flow — can't
  return to bailee custody). ``:no_completed_dispatch`` when the
  shipment has no linked Dispatch in ``completed`` state (would
  happen if someone cancelled the dispatch itself after the walk-
  out, which shouldn't normally be possible via the API).
  """
  def cancel_shipment_and_return_lot(%User{} = actor, shipment_uuid, reason \\ "cancelled from mobile hub")
      when is_binary(shipment_uuid) and is_binary(reason) do
    with :ok <- ensure_permission_dispatch_execute(actor),
         {:ok, shipment} <- fetch_shipment(actor.company_id, shipment_uuid),
         {:ok, dispatch} <- fetch_completed_dispatch_for_lot(actor.company_id, shipment.stock_lot_id) do
      dispatch_before = dispatch_snapshot(dispatch)

      result =
        Repo.transaction(fn ->
          with {:ok, cancelled} <- Backend.Shipments.cancel(actor, shipment, reason),
               {:ok, updated} <-
                 dispatch
                 |> Dispatch.return_pending_changeset()
                 |> Repo.update()
                 |> tap_audit_updated_dispatch(actor, dispatch_before) do
            %{shipment: cancelled, dispatch: updated}
          else
            {:error, reason} -> Repo.rollback(reason)
          end
        end)

      # Kick the wizard so the projects kanban re-derives the phase.
      # ``derive_dispatch_phase`` treats a lot in a dispatch cell
      # with no live shipment as ``:ready_to_dispatch`` (which reads
      # to the operator as "owe another move"); once the return
      # walk-back completes it flips back to ``:in_bailee_custody``.
      case result do
        {:ok, _} ->
          _ = notify_co_changed_for_lot(dispatch.stock_lot_id)
          result

        _ ->
          result
      end
    end
  end

  # Best-effort CO wizard notification for every CO whose MO tree
  # produced this lot. Silent-degrade posture — a missing CO doesn't
  # fail the caller, and Task.start swallows notify failures under
  # the hood.
  defp notify_co_changed_for_lot(%Lot{id: lot_id}), do: notify_co_changed_for_lot(lot_id)

  defp notify_co_changed_for_lot(lot_id) when is_integer(lot_id) do
    co_ids =
      from(mo in Backend.Production.ManufacturingOrder,
        join: col in Backend.CustomerOrders.CustomerOrderLine,
        on: col.id == mo.customer_order_line_id,
        where: mo.produced_lot_id == ^lot_id,
        distinct: col.customer_order_id,
        select: col.customer_order_id
      )
      |> Repo.all()

    Enum.each(co_ids, fn co_id ->
      _ = Backend.OrderWizard.notify_co_changed(co_id)
    end)

    :ok
  end

  defp notify_co_changed_for_lot(_), do: :ok

  @doc """
  Return-tasks queue for the mobile Return tab — dispatches whose
  linked shipment was cancelled and whose lot still needs to be
  physically walked back to bailee custody.

  Payload preloads the lot + the ``return_target_cell`` so the
  mobile FE can render the "walk to" step with FloorPlanMini
  highlighting the exact rack.

  For dispatches completed BEFORE the return_target_cell_id column
  landed (see migration ``20260904100000``) we lazily backfill the
  target by looking at the lot's Stock.Movement history — the last
  move whose ``to_cell.purpose == "dispatch"`` remembers the source
  3PL cell as ``from_cell``. Silent-degrade if no such row exists;
  the mobile FE then falls back to freeform-scan any 3PL cell in
  the warehouse.
  """
  def list_pending_returns(company_id) when is_integer(company_id) do
    from(d in Dispatch,
      where: d.company_id == ^company_id and d.status == "return_pending",
      order_by: [asc: d.dispatched_at, asc: d.id],
      preload: [
        :requested_by,
        stock_lot: [
          :item,
          :unit_of_measurement,
          :bailee_customer,
          placements: [storage_cell: [storage_location: [floor: [:warehouse]]]]
        ],
        return_target_cell: [storage_location: [floor: [:warehouse]]]
      ]
    )
    |> Repo.all()
    |> Enum.map(&maybe_backfill_return_target/1)
  end

  @doc """
  Fetch a single ``return_pending`` dispatch for the mobile scan
  flow. Same preload shape as :func:`list_pending_returns/1`.
  """
  def get_pending_return(company_id, dispatch_uuid)
      when is_integer(company_id) and is_binary(dispatch_uuid) do
    from(d in Dispatch,
      where:
        d.company_id == ^company_id and
          d.uuid == ^dispatch_uuid and
          d.status == "return_pending",
      preload: [
        :requested_by,
        stock_lot: [
          :item,
          :unit_of_measurement,
          :bailee_customer,
          placements: [storage_cell: [storage_location: [floor: [:warehouse]]]]
        ],
        return_target_cell: [storage_location: [floor: [:warehouse]]]
      ]
    )
    |> Repo.one()
    |> maybe_backfill_return_target()
  rescue
    Ecto.Query.CastError -> nil
  end

  # Fallback for dispatches completed before
  # ``20260904100000_add_return_target_to_three_pl_dispatches``
  # landed the return_target_cell_id column: walk the lot's
  # Stock.Movement history and pick the source of the most recent
  # 3PL → dispatch move. Attaches the derived cell to the struct
  # so the payload shaper sees it as if it had been stored.
  defp maybe_backfill_return_target(nil), do: nil

  defp maybe_backfill_return_target(%Dispatch{return_target_cell: %_{}} = d), do: d

  defp maybe_backfill_return_target(%Dispatch{return_target_cell_id: id} = d)
       when is_integer(id) do
    d
  end

  defp maybe_backfill_return_target(%Dispatch{stock_lot: %Lot{id: lot_id}} = d) do
    derived =
      Repo.one(
        from m in Backend.Stock.Movement,
          join: from_cell in StorageCell,
          on: from_cell.id == m.from_cell_id,
          join: to_cell in StorageCell,
          on: to_cell.id == m.to_cell_id,
          where:
            m.stock_lot_id == ^lot_id and
              m.kind == "move" and
              from_cell.purpose == "three_pl_storage" and
              to_cell.purpose == "dispatch",
          order_by: [desc: m.occurred_at, desc: m.id],
          limit: 1,
          preload: [from_cell: [storage_location: [floor: [:warehouse]]]]
      )

    case derived do
      %Backend.Stock.Movement{from_cell: cell} when not is_nil(cell) ->
        %Dispatch{d | return_target_cell: cell, return_target_cell_id: cell.id}

      _ ->
        d
    end
  end

  defp maybe_backfill_return_target(other), do: other

  @doc """
  Mobile execution — walk the lot back from its current dispatch
  cell into the original 3PL cell captured on the dispatch. Physical
  move + status flip to ``cancelled`` in one transaction.
  """
  def complete_return(%User{} = actor, dispatch_uuid, attrs)
      when is_binary(dispatch_uuid) and is_map(attrs) do
    with :ok <- ensure_permission_dispatch_execute(actor),
         %Dispatch{} = dispatch <- get_pending_return(actor.company_id, dispatch_uuid),
         %Lot{} = lot <- dispatch.stock_lot,
         {:ok, from_placement} <- find_dispatch_placement(lot),
         {:ok, to_cell} <- fetch_return_target_cell(actor.company_id, dispatch, attrs["to_cell_uuid"]) do
      dispatch_before = dispatch_snapshot(dispatch)

      result =
        Repo.transaction(fn ->
          move_attrs = %{
            "to_cell_uuid" => to_cell.uuid,
            "from_cell_uuid" => from_placement.storage_cell.uuid,
            "qty" => Decimal.to_string(dispatch.qty),
            "reason" => "3PL return"
          }

          case Stock.move_placement(actor, lot.uuid, move_attrs) do
            {:ok, _} ->
              case dispatch
                   |> Dispatch.return_completed_changeset()
                   |> Repo.update()
                   |> tap_audit_updated_dispatch(actor, dispatch_before) do
                {:ok, updated} -> %{dispatch: updated, lot: Repo.reload!(lot)}
                {:error, cs} -> Repo.rollback(cs)
              end

            {:error, reason} ->
              Repo.rollback(reason)
          end
        end)

      # Re-trigger wizard notification so the projects kanban flips
      # this CO back to :in_bailee_custody (the lot is on a 3PL cell
      # again + still ownership_kind = "bailee"). Fire-and-forget so
      # a slow NPD push never delays the picker's UI. Outside the
      # transaction — the CO update is a read that happens on the
      # NPD side, not a write we need atomic with the physical move.
      case result do
        {:ok, _} -> _ = notify_co_changed_for_lot(lot); result
        _ -> result
      end
    else
      nil -> {:error, :not_pending_return}
      err -> err
    end
  end

  # Where the lot currently sits — a placement in a ``dispatch`` cell
  # with qty > 0. Mirror of :func:`find_bailee_placement/1` but for
  # the reverse trip.
  defp find_dispatch_placement(%Lot{placements: placements}) when is_list(placements) do
    match =
      Enum.find(placements, fn p ->
        p.storage_cell && p.storage_cell.purpose == "dispatch" &&
          p.qty && Decimal.compare(p.qty, Decimal.new(0)) == :gt
      end)

    case match do
      %Placement{} = p -> {:ok, p}
      _ -> {:error, :no_dispatch_placement}
    end
  end

  defp find_dispatch_placement(_), do: {:error, :no_dispatch_placement}

  # Destination is either the operator-scanned cell (validated to be
  # a 3PL cell in the source warehouse) OR the original 3PL cell we
  # remembered at complete_dispatch time. Prefer the scanned uuid so
  # the operator can amend if the target cell got repurposed.
  defp fetch_return_target_cell(company_id, dispatch, scanned_uuid)
       when is_binary(scanned_uuid) do
    case Repo.one(
           from c in StorageCell,
             where:
               c.uuid == ^scanned_uuid and
                 c.company_id == ^company_id and
                 c.purpose == "three_pl_storage",
             preload: [storage_location: [:floor]]
         ) do
      %StorageCell{} = c -> {:ok, c}
      _ -> {:error, :bad_return_cell}
    end
  end

  defp fetch_return_target_cell(_company_id, %Dispatch{return_target_cell: %StorageCell{} = c}, _) do
    {:ok, c}
  end

  defp fetch_return_target_cell(_company_id, _dispatch, _),
    do: {:error, :bad_return_cell}

  defp fetch_shipment(company_id, shipment_uuid) do
    case Repo.get_by(Backend.Shipments.Shipment,
           company_id: company_id,
           uuid: shipment_uuid
         ) do
      %Backend.Shipments.Shipment{} = s -> {:ok, s}
      _ -> {:error, :shipment_not_found}
    end
  rescue
    Ecto.Query.CastError -> {:error, :shipment_not_found}
  end

  defp fetch_completed_dispatch_for_lot(company_id, lot_id) do
    case Repo.one(
           from d in Dispatch,
             where:
               d.company_id == ^company_id and
                 d.stock_lot_id == ^lot_id and
                 d.status == "completed",
             order_by: [desc: d.dispatched_at, desc: d.id],
             limit: 1
         ) do
      %Dispatch{} = d -> {:ok, d}
      _ -> {:error, :no_completed_dispatch}
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

  @doc """
  Cubic-metre volume for `qty` units of `lot`, using the lot's package
  dimensions. Public wrapper around the same math `lot_stored_volume_m3`
  and `lot_held_volume_m3` use, so callers outside this module (e.g.
  the shipment dispatch-dwell banner) can compute cell-scoped volumes
  without duplicating the formula. Returns `Decimal.new(0)` when any of
  L / W / H are missing.
  """
  def volume_m3_for_qty(%Lot{} = lot, qty) do
    l = lot.package_length_mm
    w = lot.package_width_mm
    h = lot.package_height_mm

    if is_integer(l) and is_integer(w) and is_integer(h) and not is_nil(qty) do
      packages_volume(l, w, h, qty, lot.units_per_package)
    else
      Decimal.new(0)
    end
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
          release: fetch_release_bundle(preloaded),
          move_in_evidence: fetch_move_in_evidence(preloaded)
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

  # Most-recent physical move that landed the lot in a
  # three_pl_storage cell. Carries the arrival photo the mobile
  # put-away flow captured (`kind = "move"`, `to_cell.purpose =
  # three_pl_storage`). Nil when the lot hasn't been physically
  # moved yet — the routing action alone doesn't create a Movement
  # row, only the mobile scan flow does.
  defp fetch_move_in_evidence(%Lot{id: lot_id}) do
    Repo.one(
      from m in Backend.Stock.Movement,
        join: to_cell in Backend.Warehouses.StorageCell,
        on: to_cell.id == m.to_cell_id,
        where:
          m.stock_lot_id == ^lot_id and
            m.kind == "move" and
            to_cell.purpose == "three_pl_storage",
        order_by: [desc: m.occurred_at, desc: m.id],
        limit: 1,
        preload: [:actor, :from_cell, :to_cell]
    )
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

  @doc """
  Bailee lots held for a specific customer, resolved by the CUSTOMER
  UUID (not the internal id). Powers the customer-facing warehouse
  visibility endpoint — the vita-cff portal proxies this and shows
  each customer their own held stock + storage costs accruing.

  Returns `[]` (never nil) when the customer isn't recognised or has
  no held stock — the customer-facing surface reads a mostly-empty
  result the same as "everything shipped", not as an error.

  Same schema as `list_bailee_lots/1` so the payload shaper can be
  shared between the staff dashboard and the integration read.
  """
  def list_bailee_lots_for_customer(company_id, customer_uuid)
      when is_integer(company_id) and is_binary(customer_uuid) do
    # Callers hit this from two different identity spaces:
    #   * PSP-side lookups (staff dashboard) pass ``Customer.uuid`` —
    #     the PSP-native UUID stamped at insert.
    #   * NPD-side portal proxy (``PortalWarehouseStockView``) passes
    #     Django's ``Customer.id`` (also a UUID) — which lands on the
    #     PSP row as ``npd_source_uuid`` via the ``resolve_customer``
    #     dedupe on the CO sync path. See ``npd_sync.ex:411``.
    # A row is a match on either column — we try the PSP-native uuid
    # first (fast path for staff) then fall back to npd_source_uuid so
    # the portal request never misses.
    customer =
      Backend.Repo.get_by(Backend.Customers.Customer,
        company_id: company_id,
        uuid: customer_uuid
      ) ||
        Backend.Repo.get_by(Backend.Customers.Customer,
          company_id: company_id,
          npd_source_uuid: customer_uuid
        )

    case customer do
      nil ->
        []

      %Backend.Customers.Customer{id: customer_id} ->
        from(l in Lot,
          where:
            l.company_id == ^company_id and
              l.ownership_kind == "bailee" and
              l.bailee_customer_id == ^customer_id and
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
  rescue
    Ecto.Query.CastError -> []
  end

  @doc """
  Bailee-flow shipments in ``draft`` — the picker has walked the
  goods to the shipping bay but the shipping form (recipient,
  address, country, planned ship date) still needs a review before
  the shipment can be marked Ready. Powers the mobile 3PL hub's
  "Paperwork" tab.

  Identity link: a shipment belongs to the bailee flow when its
  ``stock_lot.ownership_kind == "bailee"`` — the flag is persistent,
  set once by ``route_released_lot/3`` at release time.
  """
  def list_bailee_shipments_needing_paperwork(company_id)
      when is_integer(company_id) do
    bailee_shipments_by_status(company_id, ["draft"])
  end

  @doc """
  Bailee-flow shipments already marked Ready (or partially picked)
  and waiting on truck arrival. Powers the mobile 3PL hub's
  "Pickup" tab — tap opens the standard
  ``/m/shipments/[uuid]/dispatch`` truck-arrival form.
  """
  def list_bailee_shipments_ready_for_pickup(company_id)
      when is_integer(company_id) do
    bailee_shipments_by_status(company_id, ["ready", "partially_picked"])
  end

  defp bailee_shipments_by_status(company_id, statuses)
       when is_integer(company_id) and is_list(statuses) do
    from(s in Backend.Shipments.Shipment,
      join: l in Lot,
      on: l.id == s.stock_lot_id,
      where:
        s.company_id == ^company_id and
          s.status in ^statuses and
          l.ownership_kind == "bailee",
      order_by: [asc: s.ready_at, asc: s.inserted_at, asc: s.id],
      preload: [
        :customer,
        stock_lot: [
          :item,
          :unit_of_measurement,
          :bailee_customer,
          placements: [storage_cell: [storage_location: [:floor]]]
        ]
      ]
    )
    |> Repo.all()
  end

  @doc """
  Bailee-flow shipments fully picked up (all trucks logged) and now
  in transit, waiting on the customer to confirm delivery via the
  portal. Powers the mobile 3PL hub's "Confirm" tab.

  ``partially_picked`` shipments live on the Pickup tab, not here —
  they still owe another truck's worth of evidence.
  """
  def list_bailee_shipments_in_transit(company_id)
      when is_integer(company_id) do
    from(s in Backend.Shipments.Shipment,
      join: l in Lot,
      on: l.id == s.stock_lot_id,
      where:
        s.company_id == ^company_id and
          s.status == "picked_up" and
          l.ownership_kind == "bailee",
      order_by: [desc: s.picked_up_at, desc: s.id],
      preload: [
        :customer,
        stock_lot: [:item, :unit_of_measurement, :bailee_customer]
      ]
    )
    |> Repo.all()
  end

  @doc """
  Dispatch cells (`purpose = "dispatch"`) in a specific warehouse.
  Powers the mobile 3PL dispatch flow's destination-cell suggestion
  list — same warehouse constraint the completion action enforces on
  submit, so operators only ever see cells the pick can legitimately
  land in. Ordered floor → location → cell so the "walk it in" path
  reads naturally on the phone.
  """
  def list_dispatch_cells_in_warehouse(company_id, warehouse_id)
      when is_integer(company_id) and is_integer(warehouse_id) do
    from(c in StorageCell,
      join: loc in Backend.Warehouses.StorageLocation,
      on: loc.id == c.storage_location_id,
      join: f in Backend.Warehouses.Floor,
      on: f.id == loc.floor_id,
      where:
        c.company_id == ^company_id and
          c.purpose == "dispatch" and
          loc.warehouse_id == ^warehouse_id and
          is_nil(c.system_kind) and
          is_nil(loc.system_kind),
      order_by: [asc: f.name, asc: loc.name, asc: c.ordinal, asc: c.name],
      preload: [storage_location: [:floor]]
    )
    |> Repo.all()
  end

  def list_dispatch_cells_in_warehouse(_company_id, _warehouse_id), do: []

  @doc """
  Batch lookup for pending dispatch qty per lot. Given a list of lot
  ids, returns `%{lot_id => Decimal}` summing every `pending` Dispatch
  row against that lot. Lots with no pending requests are absent from
  the map (caller substitutes `Decimal.new(0)`).

  Used by the portal warehouse read to expose the delta between
  "on-hand" and "actually available to request" — a customer who
  already queued a 100-unit dispatch shouldn't see 1500 units offered
  as "available" when only 1400 truly are.
  """
  def pending_dispatch_qty_by_lot_ids(_company_id, []), do: %{}

  def pending_dispatch_qty_by_lot_ids(company_id, lot_ids)
      when is_integer(company_id) and is_list(lot_ids) do
    from(d in Dispatch,
      where:
        d.company_id == ^company_id and
          d.stock_lot_id in ^lot_ids and
          d.status == "pending",
      group_by: d.stock_lot_id,
      select: {d.stock_lot_id, sum(d.qty)}
    )
    |> Repo.all()
    |> Map.new()
  end

  @doc """
  All dispatch requests for a customer (any status), newest first.
  Powers the portal's "my dispatch requests" list. Uses the same
  dual-identity customer lookup as
  :func:`list_bailee_lots_for_customer/2`.

  Options:

    * `:status` — filter to `"pending"` / `"completed"` / `"cancelled"`.
      Omit to return every row.
    * `:lot_uuid` — narrow to a single lot (portal "view requests for
      this lot" affordance).
    * `:limit` — cap results (default 100).
  """
  def list_dispatch_requests_for_customer(company_id, customer_uuid, opts \\ [])

  def list_dispatch_requests_for_customer(company_id, customer_uuid, opts)
      when is_integer(company_id) and is_binary(customer_uuid) and is_list(opts) do
    resolved =
      Backend.Repo.get_by(Backend.Customers.Customer,
        company_id: company_id,
        uuid: customer_uuid
      ) ||
        Backend.Repo.get_by(Backend.Customers.Customer,
          company_id: company_id,
          npd_source_uuid: customer_uuid
        )

    case resolved do
      nil ->
        []

      %Backend.Customers.Customer{id: customer_id} ->
        status_filter = Keyword.get(opts, :status)
        lot_uuid_filter = Keyword.get(opts, :lot_uuid)
        limit = Keyword.get(opts, :limit, 100)

        base =
          from d in Dispatch,
            join: l in Lot,
            on: l.id == d.stock_lot_id,
            where:
              d.company_id == ^company_id and
                l.bailee_customer_id == ^customer_id,
            order_by: [desc: d.requested_at, desc: d.id],
            limit: ^limit,
            preload: [
              stock_lot: [:item, :unit_of_measurement],
              requested_by: [],
              dispatched_by: []
            ]

        base =
          if is_binary(status_filter) and status_filter in Dispatch.statuses() do
            from [d, _l] in base, where: d.status == ^status_filter
          else
            base
          end

        base =
          if is_binary(lot_uuid_filter) and lot_uuid_filter != "" do
            from [_d, l] in base, where: l.uuid == ^lot_uuid_filter
          else
            base
          end

        Repo.all(base)
    end
  rescue
    Ecto.Query.CastError -> []
  end

  # =====================================================================
  # Private
  # =====================================================================

  defp target_purpose("three_pl"), do: "three_pl_storage"
  defp target_purpose("shipment"), do: "dispatch"

  defp event_kind("three_pl"), do: "routed_to_3pl"
  defp event_kind("shipment"), do: "routed_to_shipment"

  # Kept as three arity-1 helpers rather than one parametrised
  # function so the individual call sites read like a story:
  # `ensure_permission_route` at the top of route_released_lot, etc.
  defp ensure_permission_route(actor) do
    if RBAC.has_permission?(actor, @perm_route),
      do: :ok,
      else: {:error, :forbidden}
  end

  defp ensure_permission_dispatch_request(actor) do
    if RBAC.has_permission?(actor, @perm_dispatch_request),
      do: :ok,
      else: {:error, :forbidden}
  end

  defp ensure_permission_dispatch_execute(actor) do
    if RBAC.has_permission?(actor, @perm_dispatch_execute),
      do: :ok,
      else: {:error, :forbidden}
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

  # Request-time guard — the desktop operator can't queue more than
  # what's currently held in bailee custody, NET of any pending
  # dispatches already on the queue. Otherwise two dispatch requests
  # could over-book the same lot and the picker would hit
  # insufficient_qty on the second one.
  defp ensure_bailee_qty_available(%Lot{id: lot_id, placements: placements}, qty) do
    held =
      placements
      |> Enum.filter(fn p ->
        p.storage_cell &&
          p.storage_cell.purpose == "three_pl_storage" &&
          p.qty &&
          Decimal.compare(p.qty, Decimal.new(0)) == :gt
      end)
      |> Enum.reduce(Decimal.new(0), &Decimal.add(&2, &1.qty))

    pending_claim =
      Repo.one(
        from d in Dispatch,
          where: d.stock_lot_id == ^lot_id and d.status == "pending",
          select: sum(d.qty)
      ) || Decimal.new(0)

    free = Decimal.sub(held, pending_claim)

    if Decimal.compare(free, qty) == :lt do
      {:error, :insufficient_qty}
    else
      :ok
    end
  end

  defp fetch_pending_dispatch(company_id, dispatch_uuid) do
    case Repo.one(
           from d in Dispatch,
             where:
               d.company_id == ^company_id and
                 d.uuid == ^dispatch_uuid,
             preload: [
               stock_lot: [
                 placements: [storage_cell: [storage_location: [:floor]]]
               ]
             ]
         ) do
      %Dispatch{status: "pending"} = d ->
        case d.stock_lot do
          %Lot{ownership_kind: "bailee"} = lot -> {:ok, d, lot}
          %Lot{} -> {:error, :not_bailee}
          _ -> {:error, :not_bailee}
        end

      %Dispatch{} ->
        {:error, :not_pending}

      _ ->
        {:error, :dispatch_not_found}
    end
  end

  # Scanned destination cell — must belong to the same company, be a
  # dispatch cell, AND live in the same warehouse as the source 3PL
  # cell so we can't accidentally cross-site.
  defp fetch_dispatch_cell(company_id, cell_uuid, %Placement{storage_cell: from_cell})
       when is_binary(cell_uuid) do
    from_warehouse_id =
      from_cell.storage_location.floor &&
        from_cell.storage_location.floor.warehouse_id

    case Repo.one(
           from c in StorageCell,
             join: loc in assoc(c, :storage_location),
             where:
               c.uuid == ^cell_uuid and
                 c.company_id == ^company_id and
                 c.purpose == "dispatch" and
                 loc.warehouse_id == ^from_warehouse_id,
             preload: [storage_location: [:floor]]
         ) do
      %StorageCell{} = c -> {:ok, c}
      _ -> {:error, :bad_dispatch_cell}
    end
  end

  defp fetch_dispatch_cell(_company_id, _, _), do: {:error, :bad_dispatch_cell}


  defp ensure_available(%Lot{status: "available"}), do: :ok
  defp ensure_available(_), do: {:error, :not_available}

  # Sample MOs produce customer sample kits — they follow the
  # commercial finished-quarantine + Final Product Release ceremony,
  # BUT they never route via a 3PL (we don't hold customer-owned
  # sample stock at a bailee address; samples ship direct via
  # regular courier). Enforce here so an operator can't fumble-click
  # 3PL on a sample release and strand the lot in
  # ``three_pl_storage`` cell instead of ``dispatch``. The FE
  # disables the 3PL card for sample lots; this is belt-and-braces.
  defp ensure_choice_allowed_for_lot(%Lot{id: lot_id}, "three_pl") do
    # Refuse 3PL when EITHER: (1) MO's derived project_type is
    # "sample", OR (2) the MO's linked CO is a customer-paid sample
    # fulfilment (``sample_kind = true``). Both flags mark the lot
    # as a customer sample kit that ships direct — never as a
    # bailee. The second check catches customer-paid batches where
    # the scientist picked ``kind=trial`` at Create MO time (which
    # would land the MO with ``project_type=trial`` and let the
    # first check pass, exposing the same category error the FE
    # was hitting on the routing card). Match this rule to the FE
    # gate at ``final-release-form.tsx`` so BE + FE agree on what
    # a customer sample kit is.
    case Repo.one(
           from mo in ManufacturingOrder,
             left_join: col in Backend.CustomerOrders.CustomerOrderLine,
             on: col.id == mo.customer_order_line_id,
             left_join: co in Backend.CustomerOrders.CustomerOrder,
             on: co.id == col.customer_order_id,
             where: fragment("?::text", mo.uuid) == fragment("(SELECT source_ref FROM stock_lots WHERE id = ? LIMIT 1)", ^lot_id),
             select: {mo.project_type, co.sample_kind},
             limit: 1
         ) do
      {"sample", _} -> {:error, :three_pl_not_allowed_for_sample}
      {_, true} -> {:error, :three_pl_not_allowed_for_sample}
      _ -> :ok
    end
  end

  defp ensure_choice_allowed_for_lot(_lot, _choice), do: :ok

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
