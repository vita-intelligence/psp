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
      available  → regular
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
  purpose we leave the placement alone and log a warning.
  """

  require Logger

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.Repo
  alias Backend.Stock.{Lot, Movement, Placement}
  alias Backend.Warehouses.StorageCell

  # Status → target cell purpose. Statuses absent from the map are
  # explicit no-ops; new statuses must opt in by adding a row here.
  @status_to_purpose %{
    "quarantine" => "quarantine",
    "on_hold" => "hold",
    "rejected" => "rejected",
    "available" => "regular"
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
  leave the placement alone and emit a warning — the lifecycle event
  must not fail over a routing miss.

  Returns `{:ok, [%Movement{}]}` (possibly empty) on success, or
  `{:error, reason}` if a placement / movement insert fails. Callers
  are expected to be inside `Repo.transaction/1`.
  """
  def maybe_reroute(actor_or_nil, %Lot{} = lot) do
    case target_purpose_for(lot.status) do
      nil ->
        {:ok, []}

      target_purpose ->
        reroute(actor_or_nil, lot, target_purpose)
    end
  end

  ## ----- internals --------------------------------------------------

  defp reroute(actor, %Lot{} = lot, target_purpose) do
    placements = active_placements(lot.id)

    Enum.reduce_while(placements, {:ok, []}, fn placement, {:ok, acc} ->
      case route_placement(actor, lot, placement, target_purpose) do
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
  # `{:ok, nil}` when no move is needed (already in a matching cell,
  # no candidate cell, system cell), `{:ok, movement}` when the
  # router actually shifted stock, or `{:error, reason}` to roll the
  # outer transaction back.
  defp route_placement(actor, %Lot{} = lot, %Placement{} = placement, target_purpose) do
    current_cell = placement.storage_cell

    cond do
      # Already in a cell of the right purpose — nothing to do. This
      # is the idempotent branch: re-running the router on a
      # quarantine lot in a quarantine cell is a no-op.
      current_cell && current_cell.purpose == target_purpose ->
        {:ok, nil}

      true ->
        warehouse_id = warehouse_id_for_cell(current_cell)

        case pick_target_cell(warehouse_id, target_purpose, current_cell) do
          nil ->
            Logger.warning(
              "[AutoRouter] no `#{target_purpose}` cell in warehouse_id=#{inspect(warehouse_id)} " <>
                "for lot_id=#{lot.id} status=#{lot.status} — placement_id=#{placement.id} " <>
                "left at storage_cell_id=#{placement.storage_cell_id}"
            )

            {:ok, nil}

          %StorageCell{} = target_cell ->
            move_placement(actor, lot, placement, target_cell)
        end
    end
  end

  # Find the candidate cell. Picks the lowest-id cell with the
  # matching purpose in the same warehouse, ignoring system-managed
  # slots (the Unregistered hierarchy is for manual receives, not
  # auto-routing). Tie-breaks deterministically so the same lot lands
  # in the same cell on retries.
  defp pick_target_cell(nil, _purpose, _current_cell), do: nil

  defp pick_target_cell(warehouse_id, target_purpose, current_cell)
       when is_integer(warehouse_id) do
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
        order_by: [asc: c.id],
        limit: 1

    query =
      if is_integer(current_id) do
        from c in query, where: c.id != ^current_id
      else
        query
      end

    Repo.one(query)
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
  defp move_placement(actor, %Lot{} = lot, %Placement{} = placement, %StorageCell{} = target_cell) do
    qty = placement.qty
    now = DateTime.utc_now() |> DateTime.truncate(:second)
    actor_id = actor_id(actor)

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
             "reference_kind" => "lifecycle_event",
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

  defp upsert_placement(%Lot{} = lot, %StorageCell{} = cell, qty) do
    case Repo.get_by(Placement, stock_lot_id: lot.id, storage_cell_id: cell.id) do
      %Placement{} = existing ->
        existing
        |> Placement.changeset(%{"qty" => Decimal.add(existing.qty, qty)})
        |> Repo.update()

      nil ->
        %Placement{}
        |> Placement.changeset(%{
          "company_id" => lot.company_id,
          "stock_lot_id" => lot.id,
          "storage_cell_id" => cell.id,
          "qty" => qty
        })
        |> Repo.insert()
    end
  end

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
