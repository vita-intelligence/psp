defmodule Backend.Mobile do
  @moduledoc """
  Backing service for the /m mobile home screen.

  The mobile home renders one tile per flow (pickup, preflight,
  closeout, put-away, incoming, inspections, return-pickup, 3PL). Each
  tile shows a badge with the queue size. The naive implementation
  fetches the FULL list per queue then reads `.length`, which is fine
  at seed-scale but blows up on a real tenant — a warehouse with 10 M
  historical lots would OOM the request just to render badge numbers.

  This module solves that with a **capped-count pattern**:

      SELECT COUNT(*) FROM (SELECT 1 FROM ... WHERE ... LIMIT 100) sub

  Postgres stops scanning the moment it finds 100 rows. Even against a
  10 M-row table the query touches at most 100 rows (assuming an index
  on the filter columns, which every one of these queues has). The
  home page renders "99+" when the returned count is 100, so the
  operator sees an accurate signal without paying to count precisely.

  All counts are per-tenant and gated on the caller's permission set —
  a viewer without `warehouse.pick` never sees the pickup badge, so we
  don't waste a query on it.
  """

  import Ecto.Query, warn: false

  alias Backend.Production.{ManufacturingOrder, ManufacturingOrderBooking}
  alias Backend.Repo
  alias Backend.Stock.{Lot, Placement}
  alias Backend.Warehouses.StorageCell

  # Badge display cap — the FE renders `count == @cap` as "99+". Bump
  # if the UI ever wants more granularity, but past ~2 digits the
  # actual number stops being useful ("120 pending" and "500 pending"
  # both mean "way too many, go look at the list").
  @cap 99

  @doc "Badge display cap. FE reads this if it wants to render `>{cap}+`."
  def cap, do: @cap

  @doc """
  All badge counts for one tenant, in a single map. Runs one COUNT
  query per bucket (each capped) — 8 queries total, sub-millisecond
  each on indexed tables. The controller filters by the caller's
  permissions before rendering the JSON.

  Returned counts are integers in `0..@cap`. When the caller sees the
  cap value they render "99+"; anything smaller is the real count.
  """
  def home_counts(company_id) when is_integer(company_id) do
    %{
      pickup: count_pickup_queue(company_id),
      preflight: count_preflight_queue(company_id),
      closeout: count_closeout_queue(company_id),
      putaway: count_pending_putaway(company_id),
      incoming_today: count_incoming_today(company_id),
      submitted_inspections: count_submitted_inspections(company_id),
      return_pickup: count_return_pickup_queue(company_id),
      three_pl_dispatch: count_three_pl_dispatches(company_id),
      dispatch_pickup: count_dispatch_pickup_queue(company_id)
    }
  end

  # -------------------------------------------------------------------
  # Per-bucket counters. Each mirrors the WHERE clauses of the matching
  # list function in Backend.Production / Backend.Stock / Backend.ThreePl
  # / Backend.Warehouses.ReturnPickup, but drops preloads + expensive
  # post-Elixir filtering. The badge is a signal ("how many are
  # waiting"), not the authoritative count for compliance reporting —
  # exact reconciliation happens on the per-flow list page.
  # -------------------------------------------------------------------

  # Pickup queue — released, scheduled MOs whose warehouse pickup
  # window has opened. Mirrors `Backend.Production.list_pickup_queue/1`.
  # The list function additionally hides rows before their computed
  # `visible_from` (window_hours math); the badge shows the upper
  # bound, which is fine — a picker sees the same count as the queue.
  defp count_pickup_queue(company_id) do
    # Mirror the two-shape predicate on ``list_pickup_queue/1`` so the
    # badge count matches the list rows:
    #   1. scheduled + released + pickup not complete (normal path)
    #   2. pickup_started_at set + pickup_completed_at nil (hung-
    #      pickup safety net for MOs that drifted past ``scheduled``
    #      mid-pickup)
    from(m in ManufacturingOrder,
      where:
        m.company_id == ^company_id and
          is_nil(m.pickup_completed_at) and
          ((m.status == "scheduled" and
              not is_nil(m.released_to_warehouse_at)) or
             not is_nil(m.pickup_started_at)),
      select: %{one: 1}
    )
    |> capped_count()
  end

  # Preflight queue — scheduled MOs past pickup with unfulfilled
  # bookings. Mirrors `Backend.Production.list_preflight_queue/1`.
  defp count_preflight_queue(company_id) do
    pending_mo_ids =
      from(b in ManufacturingOrderBooking,
        join: it in Backend.Items.Item,
        on: it.id == b.item_id,
        where:
          b.status == "requested" and
            it.item_type in ["raw_material", "packaging", "semi_finished", "consumable"] and
            is_nil(b.received_at),
        select: b.manufacturing_order_id,
        distinct: true
      )

    from(mo in ManufacturingOrder,
      where:
        mo.company_id == ^company_id and
          mo.status == "scheduled" and
          not is_nil(mo.pickup_completed_at) and
          mo.id in subquery(pending_mo_ids),
      select: %{one: 1}
    )
    |> capped_count()
  end

  # Closeout queue — completed MOs still owing booking consume /
  # output routing AND past output-QC. Mirrors the outer WHERE of
  # `Backend.Production.list_closeout_queue/1`. QC-blocked MOs are
  # excluded the same way.
  defp count_closeout_queue(company_id) do
    open_booking_mos =
      from(b in ManufacturingOrderBooking,
        join: it in Backend.Items.Item,
        on: it.id == b.item_id,
        where:
          b.status == "requested" and
            it.item_type in ["raw_material", "packaging", "semi_finished", "consumable"] and
            is_nil(b.consumed_at),
        select: b.manufacturing_order_id,
        distinct: true
      )

    # Reserved-lot inclusion — matches ``list_closeout_queue/1``.
    # Operator owns the routing decision (keep-in-place vs move-to-
    # warehouse) so we surface the MO in the badge even when the
    # downstream booking is live.
    output_at_feed =
      from(p in Placement,
        join: l in Lot,
        on: l.id == p.stock_lot_id,
        join: m in ManufacturingOrder,
        on: fragment("?::text", m.uuid) == l.source_ref,
        where:
          l.company_id == ^company_id and
            l.source_kind == "manufacturing_order" and
            l.status == "available" and
            p.qty > 0 and
            p.storage_cell_id == m.production_cell_id and
            m.project_type != "trial",
        select: m.id,
        distinct: true
      )

    awaiting_qc_mos =
      from(l in Lot,
        join: m in ManufacturingOrder,
        on: fragment("?::text", m.uuid) == l.source_ref,
        where:
          l.company_id == ^company_id and
            l.source_kind == "manufacturing_order" and
            l.status == "received",
        select: m.id,
        distinct: true
      )

    from(mo in ManufacturingOrder,
      where:
        mo.company_id == ^company_id and
          mo.status == "completed" and
          # Mirror list_closeout_queue/1: the operator-marked
          # `closeout_completed_at` stamp drops the row from the queue
          # regardless of physical stock state (needed for R&D
          # single-cell closeouts that are a no-op on the stock side).
          is_nil(mo.closeout_completed_at) and
          mo.id not in subquery(awaiting_qc_mos) and
          (mo.id in subquery(open_booking_mos) or mo.id in subquery(output_at_feed)),
      select: %{one: 1}
    )
    |> capped_count()
  end

  # Put-away queue — lots in unregistered / just-cleared / owed-release
  # cells. Mirrors `Backend.Stock.list_pending_putaway/1` verbatim on
  # the WHERE side.
  defp count_pending_putaway(company_id) do
    not_released_lot_ids =
      from(l in Lot,
        left_join: r in Backend.Production.FinalRelease,
        on:
          r.stock_lot_id == l.id and
            r.status in ["released", "on_hold", "rejected"],
        left_join: b in ManufacturingOrderBooking,
        on: b.stock_lot_id == l.id,
        left_join: mo in ManufacturingOrder,
        on: mo.id == b.manufacturing_order_id and mo.status != "cancelled",
        where:
          l.company_id == ^company_id and
            l.source_kind == "manufacturing_order" and
            l.status in ["awaiting_release", "available"] and
            is_nil(r.id) and
            is_nil(mo.id),
        select: l.id
      )

    routed_lot_ids =
      from(e in Backend.Stock.LotEvent,
        where: e.kind in ["routed_to_3pl", "routed_to_shipment"],
        select: e.stock_lot_id,
        distinct: true
      )

    from(l in Lot,
      join: p in Placement,
      on: p.stock_lot_id == l.id,
      join: c in StorageCell,
      on: c.id == p.storage_cell_id,
      where:
        l.company_id == ^company_id and
          p.qty > 0 and
          (c.system_kind == "unregistered" or
             (l.status == "available" and c.purpose == "quarantine") or
             (l.id in subquery(not_released_lot_ids) and
                c.purpose != "finished_quarantine") or
             (l.id in subquery(routed_lot_ids) and
                c.purpose == "finished_quarantine")),
      select: l.id,
      distinct: true
    )
    |> capped_count()
  end

  # Incoming today — PO lines with an expected receipt inside the
  # default 7-day window. Deferred to the existing service so any
  # tweak to the window filter stays in one place; capped by taking
  # the first cap+1 rows.
  defp count_incoming_today(company_id) do
    case Backend.GoodsIn.MobileIncoming.list_expected(company_id, window_days: 7) do
      %{items: items} when is_list(items) ->
        items |> Enum.take(@cap + 1) |> length() |> Kernel.min(@cap)

      _ ->
        0
    end
  end

  # Submitted inspections — inspection rows waiting on QC sign-off.
  # This is what the mobile Inspections tile badges. A capped count on
  # `status = "submitted"` is enough — inspections are a narrow row
  # count in practice (measured in tens, not thousands).
  defp count_submitted_inspections(company_id) do
    from(i in Backend.GoodsIn.Inspection,
      where: i.company_id == ^company_id and i.status == "submitted",
      select: %{one: 1}
    )
    |> capped_count()
  end

  # Return-pickup queue — MOs with post-closeout stock still sitting
  # on a production-facility cell. The full query in
  # `Backend.Warehouses.ReturnPickup.list_queue/1` is intricate
  # (open-pick exclusion, downstream-claim guard, consumed-lot dedupe,
  # outbound-path exclusion, ingredient / cancelled-orphan buckets) —
  # mirroring it here means two definitions of the same set that drift
  # every time the queue rules change (which is often). Instead we run
  # the real list and cap it, matching how `count_incoming_today` also
  # defers to its source-of-truth service. Return-pickup is a small
  # bounded set per tenant (post-closeout completed / cancelled MOs
  # with stock on production cells), so length + take is cheap.
  defp count_return_pickup_queue(company_id) do
    company_id
    |> Backend.Warehouses.ReturnPickup.list_queue()
    |> Enum.take(@cap + 1)
    |> length()
    |> Kernel.min(@cap)
  end

  # 3PL dispatch queue — pending dispatch rows for this tenant. Direct
  # mirror of `Backend.ThreePl.list_pending_dispatches/1`'s WHERE.
  defp count_three_pl_dispatches(company_id) do
    from(d in Backend.ThreePL.Dispatch,
      where: d.company_id == ^company_id and d.status == "pending",
      select: %{one: 1}
    )
    |> capped_count()
  end

  # Dispatch pickup queue — shipments the coordinator has marked
  # ``ready``, waiting for the truck to arrive. Uses the same partial
  # ``shipments_ready_queue_idx`` index the mobile list endpoint uses,
  # so capped_count answers in a bounded number of index touches even
  # when the shipments table has millions of historical rows.
  defp count_dispatch_pickup_queue(company_id) do
    from(s in Backend.Shipments.Shipment,
      where: s.company_id == ^company_id and s.status == "ready",
      select: %{one: 1}
    )
    |> capped_count()
  end

  # -------------------------------------------------------------------
  # Helpers
  # -------------------------------------------------------------------

  # Wraps the given query with a hard LIMIT of cap+1 then counts the
  # subquery. Postgres stops scanning after cap+1 rows regardless of
  # table size, so the cost stays bounded even against millions of
  # matching rows.
  #
  # Uses an explicit subquery + `select: count()` (instead of
  # `Repo.aggregate/2`) so the semantics stay obvious no matter what
  # the inner query's `select`, `distinct`, or `preload` looks like.
  # Returns an integer in `0..@cap`; the FE renders `@cap` as "99+".
  defp capped_count(query) do
    limited = from(q in query, limit: ^(@cap + 1))

    from(sub in subquery(limited), select: count())
    |> Repo.one()
    |> case do
      nil -> 0
      n -> min(n, @cap)
    end
  end
end
