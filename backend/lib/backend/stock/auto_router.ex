defmodule Backend.Stock.AutoRouter do
  @moduledoc """
  Decision-driven auto-routing for stock placements.

  When a lot's lifecycle status changes, the auto-router walks every
  active placement and moves it to a storage cell whose `purpose`
  matches the new status. Without this, the database can claim a lot
  is `quarantine` while it physically sits in a regular pick face —
  the warehouse floor and the compliance status drift apart.

  Routing matrix (status → target cell purpose):

      quarantine → quarantine
      on_hold    → hold
      rejected   → rejected
      available  → NO MOVE — the operator owns the put-away decision.
                   QC-passed lots physically stay in the quarantine bay
                   until the put-away flow assigns them a real shelf;
                   silently auto-shelving to a regular cell bypasses
                   that decision and breaks BRCGS chain-of-custody.
                   `list_pending_putaway/1` picks up status=available
                   lots still sitting in a quarantine cell.
      depleted   → no move (qty 0)
      disposed   → no move (physically destroyed)
      received   → no move (waiting on quarantine routing event)
      expected   → no move (no goods yet)
      requested  → no move (no goods yet)
      canceled   → no move

  The router runs **inside** the same `Repo.transaction/1` as the
  lifecycle event so a failed placement update rolls the lot status
  back with it. The lifecycle event itself never fails over a
  routing miss — if the warehouse has no cell of the required
  purpose (or every candidate is over-capacity) we leave the
  placement alone AND record a `stock_lot_lifecycle_events` audit
  row so the lot detail page shows the miss to the operator. The
  event level (`no_target_cell_of_purpose` / `no_target_cell_with_capacity`)
  lets the warehouse manager tell "we forgot to create a cell" from
  "the shelf is full" at a glance.
  """

  require Logger

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.Repo
  alias Backend.Stock
  alias Backend.Stock.{Lot, LotEvent, Movement, Placement}
  alias Backend.Warehouses.StorageCell

  # Status → target cell purpose. Statuses absent from the map are
  # explicit no-ops; new statuses must opt in by adding a row here.
  @status_to_purpose %{
    "quarantine" => "quarantine",
    "awaiting_release" => "finished_quarantine",
    "on_hold" => "hold",
    "rejected" => "rejected"
  }

  @doc """
  Public hook for the routing-relevant statuses; exposed so callers
  can decide whether to even fetch the lot's placements.
  """
  def target_purpose_for(status) when is_binary(status),
    do: Map.get(@status_to_purpose, status)

  def target_purpose_for(_), do: nil

  @doc """
  After a lifecycle event has updated a lot's projected status, walk
  every active placement (qty > 0) and re-route it to a cell of the
  matching purpose inside the same warehouse.

  Idempotent: a placement already sitting in a cell of the target
  purpose is skipped. Warehouses with no cell of the target purpose
  (or with every candidate over-capacity) leave the placement alone,
  log a warning, AND record a `routing_skipped` audit row on the
  triggering lifecycle event so the miss is visible on the lot's
  timeline. The lifecycle event itself does NOT fail — an audit
  operator must not be blocked from receiving stock just because
  the warehouse forgot to seed a quarantine cell.

  `triggering_event` is the `%LotEvent{}` that caused the
  reroute (from `Backend.Stock.Lifecycle.record_event_in_transaction/3`).
  When present, the emitted `stock_movement` rows carry a FK to it
  via `reference_kind: "lifecycle_event"` so an auditor can trace
  every auto-move back to the QC verdict that triggered it.

  Returns `{:ok, [%Movement{}]}` (possibly empty) on success, or
  `{:error, reason}` if a placement / movement insert fails. Callers
  are expected to be inside `Repo.transaction/1`.
  """
  def maybe_reroute(actor_or_nil, lot, triggering_event \\ nil)

  def maybe_reroute(actor_or_nil, %Lot{} = lot, triggering_event) do
    case target_purpose_for(lot.status) do
      nil ->
        {:ok, []}

      target_purpose ->
        reroute(actor_or_nil, lot, target_purpose, triggering_event)
    end
  end

  ## ----- internals --------------------------------------------------

  defp reroute(actor, %Lot{} = lot, target_purpose, triggering_event) do
    placements = active_placements(lot.id)

    Enum.reduce_while(placements, {:ok, []}, fn placement, {:ok, acc} ->
      case route_placement(actor, lot, placement, target_purpose, triggering_event) do
        {:ok, nil} -> {:cont, {:ok, acc}}
        {:ok, %Movement{} = m} -> {:cont, {:ok, [m | acc]}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
    |> case do
      {:ok, movements} -> {:ok, Enum.reverse(movements)}
      other -> other
    end
  end

  # Move one placement to a cell of the right purpose. Returns
  # `{:ok, nil}` when no move happens (already in a matching cell,
  # no candidate cell, every candidate over-capacity), `{:ok, movement}`
  # when the router actually shifted stock, or `{:error, reason}` to
  # roll the outer transaction back on a hard failure (constraint
  # violation, DB error).
  defp route_placement(actor, %Lot{} = lot, %Placement{} = placement, target_purpose, triggering_event) do
    current_cell = placement.storage_cell

    cond do
      # Already in a cell of the right purpose — nothing to do. This
      # is the idempotent branch: re-running the router on a
      # quarantine lot in a quarantine cell is a no-op.
      current_cell && current_cell.purpose == target_purpose ->
        {:ok, nil}

      true ->
        warehouse_id = warehouse_id_for_cell(current_cell)

        case pick_target_cell_with_capacity(
               warehouse_id,
               target_purpose,
               current_cell,
               lot,
               placement
             ) do
          {:ok, %StorageCell{} = target_cell} ->
            move_placement(actor, lot, placement, target_cell, triggering_event)

          {:error, :no_cell_of_purpose} ->
            log_and_record_skip(
              actor,
              lot,
              placement,
              target_purpose,
              warehouse_id,
              triggering_event,
              :no_target_cell_of_purpose,
              "No `#{target_purpose}` cell exists in this warehouse — create one via Settings → Warehouses."
            )

            {:ok, nil}

          {:error, :no_cell_with_capacity} ->
            log_and_record_skip(
              actor,
              lot,
              placement,
              target_purpose,
              warehouse_id,
              triggering_event,
              :no_target_cell_with_capacity,
              "Every `#{target_purpose}` cell is over dimensional / weight capacity — clear a cell or add another."
            )

            {:ok, nil}
        end
    end
  end

  # Find the best-fitting candidate cell. Walks all matching-purpose,
  # operator-owned cells in the warehouse ordered by id (deterministic
  # tie-break so retries land in the same cell) and returns the first
  # one whose dimensional / weight capacity can absorb this placement.
  #
  # Returns `{:ok, cell}` on success, `{:error, :no_cell_of_purpose}`
  # when the warehouse has zero cells of the target purpose, or
  # `{:error, :no_cell_with_capacity}` when cells exist but every one
  # is too full for this lot. The three-outcome return lets the
  # caller record a specific audit reason (missing cell vs. full
  # shelves) so the operator knows what to fix.
  defp pick_target_cell_with_capacity(nil, _purpose, _current_cell, _lot, _placement),
    do: {:error, :no_cell_of_purpose}

  defp pick_target_cell_with_capacity(warehouse_id, target_purpose, current_cell, lot, placement)
       when is_integer(warehouse_id) do
    candidates = list_candidate_cells(warehouse_id, target_purpose, current_cell)

    case candidates do
      [] ->
        {:error, :no_cell_of_purpose}

      cells ->
        # Fit check runs with the placement's ACTUAL qty (auto-route
        # always moves the whole placement) so a lot that overflows
        # the first-picked cell walks the list until it lands
        # somewhere real. `ensure_placement_fits` in strict mode
        # refuses cells with unknown-dim lots too, matching the
        # spirit of "don't silently put a legacy lot in an over-full
        # cell just because its dims aren't recorded".
        case Enum.find(cells, fn cell ->
               Stock.ensure_placement_fits(lot, cell, placement.qty) == :ok
             end) do
          %StorageCell{} = ok_cell -> {:ok, ok_cell}
          nil -> {:error, :no_cell_with_capacity}
        end
    end
  end

  # Pull every operator-owned candidate for the purpose — ordered
  # deterministically so retries pick the same cell. The order is
  # the same one the old single-cell picker used (asc id), so
  # nothing changes for warehouses whose first cell always fits.
  defp list_candidate_cells(warehouse_id, target_purpose, current_cell) do
    current_id = current_cell && current_cell.id

    query =
      from c in StorageCell,
        join: l in assoc(c, :storage_location),
        join: f in assoc(l, :floor),
        where: f.warehouse_id == ^warehouse_id,
        where: c.purpose == ^target_purpose,
        where: is_nil(c.system_kind),
        where: is_nil(l.system_kind),
        where: is_nil(f.system_kind),
        order_by: [asc: c.id]

    query =
      if is_integer(current_id) do
        from c in query, where: c.id != ^current_id
      else
        query
      end

    Repo.all(query)
  end

  defp warehouse_id_for_cell(nil), do: nil

  defp warehouse_id_for_cell(%StorageCell{} = c) do
    c =
      if Ecto.assoc_loaded?(c.storage_location) do
        c
      else
        Repo.preload(c, storage_location: :floor)
      end

    cond do
      is_nil(c.storage_location) ->
        nil

      Ecto.assoc_loaded?(c.storage_location.floor) and c.storage_location.floor ->
        c.storage_location.floor.warehouse_id

      true ->
        loc =
          Repo.preload(c.storage_location, :floor)

        loc.floor && loc.floor.warehouse_id
    end
  end

  defp active_placements(lot_id) do
    from(p in Placement,
      where: p.stock_lot_id == ^lot_id,
      where: p.qty > 0,
      preload: [storage_cell: [storage_location: :floor]],
      order_by: [asc: p.id]
    )
    |> Repo.all()
  end

  # Decrement the source placement, upsert the destination, write the
  # `auto_route` movement. Mirrors `Backend.Stock.move_placement` but
  # for the full placement qty (auto-routing always moves all of it —
  # partial routing would defeat the compliance guarantee).
  #
  # When a `triggering_event` is provided, the emitted movement
  # carries `reference_kind: "lifecycle_event"` and `reference_ref:
  # event.uuid` so audit queries can join every auto-route back to
  # the QC verdict that triggered it — closes the "which event
  # caused this move?" gap in the movement audit trail.
  defp move_placement(actor, %Lot{} = lot, %Placement{} = placement, %StorageCell{} = target_cell, triggering_event) do
    qty = placement.qty
    now = DateTime.utc_now() |> DateTime.truncate(:second)
    actor_id = actor_id(actor)

    {ref_kind, ref_ref} = reference_from_event(triggering_event)

    with {:ok, decremented} <-
           placement
           |> Placement.changeset(%{"qty" => Decimal.sub(placement.qty, qty)})
           |> Repo.update(),
         {:ok, _new_to} <-
           upsert_placement(lot, target_cell, qty),
         {:ok, movement} <-
           %Movement{}
           |> Movement.changeset(%{
             "company_id" => lot.company_id,
             "stock_lot_id" => lot.id,
             "from_cell_id" => placement.storage_cell_id,
             "to_cell_id" => target_cell.id,
             "delta_qty" => qty,
             "kind" => "auto_route",
             "reason" => "Auto-routed for status=#{lot.status}",
             "reference_kind" => ref_kind,
             "reference_ref" => ref_ref,
             "actor_id" => actor_id,
             "occurred_at" => now
           })
           |> Repo.insert() do
      maybe_audit_move(actor, lot, placement, decremented, movement)
      {:ok, movement}
    else
      {:error, %Ecto.Changeset{} = cs} -> {:error, cs}
      {:error, reason} -> {:error, reason}
    end
  end

  # Placement upsert atomic on the unique constraint
  # (stock_lot_id, storage_cell_id). The old code did
  # ``Repo.get_by → conditional insert/update`` which had a race
  # window where two concurrent auto-routes on the same lot/cell
  # both saw ``nil`` from ``get_by`` and both tried ``insert`` —
  # the second one hit the unique constraint and blew up the
  # outer transaction (which is fatal for the whole lifecycle
  # event).
  #
  # ``ON CONFLICT ... DO UPDATE SET qty = existing + incoming``
  # collapses that into a single atomic SQL statement Postgres
  # serializes at the row level, so concurrent auto-routes on the
  # same cell just increment cleanly.
  defp upsert_placement(%Lot{} = lot, %StorageCell{} = cell, qty) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    attrs = %{
      "company_id" => lot.company_id,
      "stock_lot_id" => lot.id,
      "storage_cell_id" => cell.id,
      "qty" => qty
    }

    %Placement{}
    |> Placement.changeset(attrs)
    |> Repo.insert(
      on_conflict:
        from(p in Placement,
          update: [
            set: [
              qty: fragment("? + ?", p.qty, ^qty),
              updated_at: ^now
            ]
          ]
        ),
      conflict_target: [:stock_lot_id, :storage_cell_id],
      returning: true
    )
  end

  defp reference_from_event(nil), do: {"lifecycle_event", nil}

  defp reference_from_event(%LotEvent{uuid: uuid}) when is_binary(uuid),
    do: {"lifecycle_event", uuid}

  defp reference_from_event(_), do: {"lifecycle_event", nil}

  # Record a lifecycle event + audit row when auto-routing had
  # nowhere to move the placement. Two shapes:
  #
  #   * ``no_target_cell_of_purpose`` — warehouse has zero cells
  #     of the target purpose. Operator needs to seed one via
  #     Settings → Warehouses.
  #   * ``no_target_cell_with_capacity`` — cells exist but every
  #     one is over dimensional or weight capacity for this lot.
  #     Operator needs to clear a cell or add another shelf.
  #
  # The audit row hangs off the lot so it surfaces on the lot
  # detail page's activity feed — the operator sees "auto-route
  # skipped, reason: X, next action: Y" the next time they look
  # at the lot instead of the receive silently succeeding while
  # the placement stays in the wrong cell.
  defp log_and_record_skip(
         actor,
         %Lot{} = lot,
         %Placement{} = placement,
         target_purpose,
         warehouse_id,
         triggering_event,
         reason_code,
         detail
       ) do
    Logger.error(
      "[AutoRouter] #{reason_code} — no `#{target_purpose}` cell in " <>
        "warehouse_id=#{inspect(warehouse_id)} for lot_id=#{lot.id} " <>
        "status=#{lot.status} — placement_id=#{placement.id} left at " <>
        "storage_cell_id=#{placement.storage_cell_id}. #{detail}"
    )

    audit_actor = actor || %{id: nil}
    trigger_uuid = trigger_event_uuid(triggering_event)

    Audit.record_created(
      audit_actor,
      "stock_lot_auto_route_skipped",
      %{
        id: lot.id,
        uuid: lot.uuid
      },
      %{
        lot_id: lot.id,
        lot_status: lot.status,
        target_purpose: target_purpose,
        placement_id: placement.id,
        current_cell_id: placement.storage_cell_id,
        warehouse_id: warehouse_id,
        triggering_event_uuid: trigger_uuid,
        reason_code: to_string(reason_code),
        detail: detail
      }
    )

    :ok
  end

  defp trigger_event_uuid(%LotEvent{uuid: uuid}) when is_binary(uuid), do: uuid
  defp trigger_event_uuid(_), do: nil

  defp maybe_audit_move(nil, _lot, _before, _after_p, _movement), do: :ok

  defp maybe_audit_move(%User{} = actor, _lot, before_placement, after_placement, movement) do
    Audit.record_updated(
      actor,
      "stock_lot_placement",
      after_placement,
      %{
        qty: before_placement.qty,
        storage_cell_id: before_placement.storage_cell_id
      },
      %{qty: after_placement.qty, storage_cell_id: after_placement.storage_cell_id}
    )

    Audit.record_created(actor, "stock_movement", movement, %{
      kind: movement.kind,
      delta_qty: movement.delta_qty,
      from_cell_id: movement.from_cell_id,
      to_cell_id: movement.to_cell_id,
      reason: movement.reason
    })

    :ok
  end

  defp actor_id(%User{id: id}), do: id
  defp actor_id(_), do: nil
end
