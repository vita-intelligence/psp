defmodule Backend.CustomerOrders.TimeBreakdown do
  @moduledoc """
  Wall-clock time roll-up for the wizard "time so far" card. Companion
  to `Backend.Production.Costing` — same shape (`totals`, per-item
  drill-down, `active_labour_running_seconds` for live tick), different
  numerator (seconds not money).

  ## Phase model

  The wizard has 12 fine-grained phases (see `Backend.OrderWizard`),
  but only some have a clean transition timestamp. This module ships
  what we can compute today and groups the fuzzy middle:

    * `:setup`                        co.inserted_at → co.submitted_at
    * `:approval`                     co.submitted_at → co.confirmed_at
    * `:preparing_production`         co.confirmed_at → first session started
                                      (covers wizard's :production_planning
                                      + :awaiting_ingredients)
    * `:in_production`                first session started → last session
                                      finished (ticks live while any is active)
    * `:post_production_pre_dispatch` last session finished → first shipment ready
                                      (covers wizard's :closeout + :final_release
                                      + :awaiting_routing + :ready_to_dispatch)
    * `:awaiting_pickup`              first shipment ready → last picked_up
    * `:dispatched`                   first picked_up → last delivered
    * `:delivered`                    last delivered → (terminal)
    * `:cancelled`                    covers whichever phase was active
                                      when the order was cancelled

  Any phase whose `started_at` is nil is marked `is_tracked: false`
  and reports `duration_seconds: nil` — the FE renders it as "not
  reached" rather than dropping the row.

  ## Labour

  `labour_seconds` = sum of every WorkstationSession duration across
  the CO's MO tree. Distinct from `total_elapsed_seconds` because
  labour excludes gaps between sessions.
  """

  import Ecto.Query

  alias Backend.CustomerOrders.CustomerOrder
  alias Backend.Production.WorkstationSession
  alias Backend.Repo
  alias Backend.Shipments.Shipment

  @doc """
  Whole tenant-scoped breakdown by CO integer id.

  Returns nil when the CO doesn't belong to the given company.
  """
  def customer_order_time_breakdown(company_id, co_id)
      when is_integer(company_id) and is_integer(co_id) do
    co =
      Repo.one(
        from c in CustomerOrder,
          where: c.company_id == ^company_id and c.id == ^co_id,
          preload: [:company]
      )

    if is_nil(co) do
      nil
    else
      now = DateTime.utc_now()
      mo_ids = fetch_mo_tree_ids(company_id, co_id)
      session_stats = fetch_session_stats(mo_ids, company_id)
      shipment_stats = fetch_shipment_stats(company_id, co_id)

      raw_phases = build_phases(co, session_stats, shipment_stats, now)
      phases = mark_current(raw_phases, co)

      started_at = co.inserted_at
      ended_at = terminal_end(co, shipment_stats)
      is_live = is_nil(ended_at) && co.status != "cancelled"
      total_seconds = if started_at, do: seconds_between(started_at, ended_at || now), else: 0

      %{
        customer_order: %{
          uuid: co.uuid,
          code: render_code(co.company, co.id)
        },
        started_at: started_at,
        ended_at: ended_at,
        is_live: is_live,
        total_elapsed_seconds: total_seconds,
        phases: phases,
        labour_seconds: session_stats.labour_seconds,
        session_count: session_stats.count,
        active_session_count: session_stats.active_count,
        generated_at: now
      }
    end
  end

  # ---------- Phase construction ----------

  defp build_phases(co, sessions, shipments, now) do
    setup =
      phase(:setup, "Setup", co.inserted_at, co.submitted_at, now,
        description: "Draft the order + line up the customer, price, and delivery."
      )

    approval =
      phase(:approval, "Approval", co.submitted_at, co.confirmed_at, now,
        description: "Two-tier internal sign-off before production releases."
      )

    preparing =
      phase(
        :preparing_production,
        "Preparing production",
        co.confirmed_at,
        sessions.first_started_at,
        now,
        description:
          "Spawn MOs, plan the schedule, gather ingredients. Combines the wizard's " <>
            "planning + awaiting-ingredients phases (no transition timestamp yet)."
      )

    producing =
      phase(
        :in_production,
        "Producing",
        sessions.first_started_at,
        sessions.last_finished_at_if_all_done,
        now,
        description:
          "Kiosk sessions on the floor. Ticks live while any session is active."
      )

    post_pre_dispatch =
      phase(
        :post_production_pre_dispatch,
        "Closeout + release + routing",
        sessions.last_finished_at_if_all_done,
        shipments.first_ready_at,
        now,
        description:
          "QC verdicts, final product release (BRCGS 5.6), 3PL routing decisions, " <>
            "shipment paperwork. Combined — no transition log yet."
      )

    awaiting_pickup =
      phase(
        :awaiting_pickup,
        "Awaiting pickup",
        shipments.first_ready_at,
        shipments.last_picked_up_at_if_all_gone,
        now,
        description: "Shipment paperwork signed, waiting for the truck."
      )

    dispatched =
      phase(
        :dispatched,
        "In transit",
        shipments.first_picked_up_at,
        shipments.last_delivered_at_if_all_done,
        now,
        description: "Goods have left. Waiting for the POD to confirm receipt."
      )

    delivered =
      phase(
        :delivered,
        "Delivered",
        shipments.last_delivered_at_if_all_done,
        nil,
        now,
        description: "Every shipment signed off at destination."
      )

    base = [
      setup,
      approval,
      preparing,
      producing,
      post_pre_dispatch,
      awaiting_pickup,
      dispatched,
      delivered
    ]

    if co.status == "cancelled" and co.cancelled_at do
      # Any phase that hasn't finished by cancellation is truncated
      # at cancelled_at so we don't leak a "live tick" past a terminal
      # state.
      Enum.map(base, fn phase ->
        case phase do
          %{ended_at: nil, started_at: %DateTime{} = s} when co.cancelled_at != nil ->
            if DateTime.compare(co.cancelled_at, s) == :gt do
              seconds = DateTime.diff(co.cancelled_at, s, :second)

              %{phase | ended_at: co.cancelled_at, duration_seconds: max(seconds, 0)}
            else
              phase
            end

          other ->
            other
        end
      end) ++
        [
          %{
            key: :cancelled,
            label: "Cancelled",
            started_at: co.cancelled_at,
            ended_at: co.cancelled_at,
            duration_seconds: 0,
            is_tracked: true,
            is_current: true,
            is_terminal: true,
            description: "Order cancelled — nothing else moves."
          }
        ]
    else
      base
    end
  end

  defp phase(key, label, started_at, ended_at, now, opts) do
    started_at = maybe_dt(started_at)
    ended_at = maybe_dt(ended_at)
    description = Keyword.get(opts, :description)

    {duration_seconds, is_current} =
      cond do
        is_nil(started_at) ->
          {nil, false}

        is_nil(ended_at) ->
          # Live tick — measure from start to now.
          {max(DateTime.diff(now, started_at, :second), 0), true}

        true ->
          {max(DateTime.diff(ended_at, started_at, :second), 0), false}
      end

    %{
      key: key,
      label: label,
      started_at: started_at,
      ended_at: ended_at,
      duration_seconds: duration_seconds,
      is_tracked: not is_nil(started_at),
      is_current: is_current,
      is_terminal: false,
      description: description
    }
  end

  # After building, the "current" phase is the last one with is_tracked
  # AND ended_at IS NULL. Everything after it in the list is future-tense
  # (started_at nil). Everything before it is finished. Cancelled COs
  # already carry an explicit cancelled row so their :is_current comes
  # from there.
  defp mark_current(phases, %CustomerOrder{status: "cancelled"}), do: phases

  defp mark_current(phases, _co) do
    idx_of_current =
      Enum.find_index(phases, fn p -> p.is_tracked and is_nil(p.ended_at) end)

    case idx_of_current do
      nil ->
        # Every tracked phase has finished — the last tracked one is
        # the terminal, no live phase.
        phases

      i ->
        Enum.with_index(phases)
        |> Enum.map(fn {p, j} -> %{p | is_current: j == i} end)
    end
  end

  # ---------- Session roll-up ----------

  defp fetch_session_stats([], _company_id) do
    %{
      first_started_at: nil,
      last_finished_at_if_all_done: nil,
      labour_seconds: 0,
      count: 0,
      active_count: 0
    }
  end

  defp fetch_session_stats(mo_ids, company_id) do
    rows =
      Repo.all(
        from s in WorkstationSession,
          join: step in assoc(s, :manufacturing_order_step),
          where:
            s.company_id == ^company_id and
              step.manufacturing_order_id in ^mo_ids,
          select: %{
            started_at: s.started_at,
            finished_at: s.finished_at,
            status: s.status
          }
      )

    now = DateTime.utc_now()

    first_started_at =
      rows
      |> Enum.map(& &1.started_at)
      |> Enum.reject(&is_nil/1)
      |> min_or_nil()

    all_finished? = Enum.all?(rows, &(&1.status != "active" and not is_nil(&1.finished_at)))

    last_finished_at =
      if all_finished? do
        rows
        |> Enum.map(& &1.finished_at)
        |> Enum.reject(&is_nil/1)
        |> max_or_nil()
      else
        nil
      end

    active_count = Enum.count(rows, &(&1.status == "active"))

    labour_seconds =
      Enum.reduce(rows, 0, fn row, acc ->
        case row do
          %{started_at: nil} ->
            acc

          %{status: "active", started_at: s, finished_at: nil} ->
            acc + max(DateTime.diff(now, s, :second), 0)

          %{finished_at: nil} ->
            acc

          %{started_at: s, finished_at: f} ->
            acc + max(DateTime.diff(f, s, :second), 0)
        end
      end)

    %{
      first_started_at: first_started_at,
      last_finished_at_if_all_done: last_finished_at,
      labour_seconds: labour_seconds,
      count: length(rows),
      active_count: active_count
    }
  end

  # ---------- Shipment roll-up ----------

  defp fetch_shipment_stats(company_id, co_id) do
    rows =
      Repo.all(
        from s in Shipment,
          where:
            s.company_id == ^company_id and
              s.customer_order_id == ^co_id and
              s.status != "cancelled",
          select: %{
            status: s.status,
            ready_at: s.ready_at,
            picked_up_at: s.picked_up_at,
            delivered_at: s.delivered_at
          }
      )

    if rows == [] do
      %{
        first_ready_at: nil,
        last_picked_up_at_if_all_gone: nil,
        first_picked_up_at: nil,
        last_delivered_at_if_all_done: nil
      }
    else
      first_ready_at =
        rows
        |> Enum.map(& &1.ready_at)
        |> Enum.reject(&is_nil/1)
        |> min_or_nil()

      first_picked_up_at =
        rows
        |> Enum.map(& &1.picked_up_at)
        |> Enum.reject(&is_nil/1)
        |> min_or_nil()

      all_picked? = Enum.all?(rows, &(&1.picked_up_at != nil))

      last_picked_up_at =
        if all_picked? do
          rows |> Enum.map(& &1.picked_up_at) |> max_or_nil()
        end

      all_delivered? = Enum.all?(rows, &(&1.delivered_at != nil))

      last_delivered_at =
        if all_delivered? do
          rows |> Enum.map(& &1.delivered_at) |> max_or_nil()
        end

      %{
        first_ready_at: first_ready_at,
        last_picked_up_at_if_all_gone: last_picked_up_at,
        first_picked_up_at: first_picked_up_at,
        last_delivered_at_if_all_done: last_delivered_at
      }
    end
  end

  # ---------- helpers ----------

  # Same recursive CTE the sessions + costing endpoints use.
  defp fetch_mo_tree_ids(company_id, co_id) do
    tree_query = """
      WITH RECURSIVE mo_tree AS (
        SELECT mo.id
        FROM manufacturing_orders mo
        JOIN customer_order_lines col ON col.id = mo.customer_order_line_id
        WHERE col.customer_order_id = $1 AND mo.company_id = $2
        UNION ALL
        SELECT child.id
        FROM manufacturing_orders child
        JOIN mo_tree parent ON parent.id = child.parent_mo_id
        WHERE child.company_id = $2
      )
      SELECT id FROM mo_tree
    """

    %{rows: rows} = Repo.query!(tree_query, [co_id, company_id])
    Enum.map(rows, &List.first/1)
  end

  defp terminal_end(%CustomerOrder{status: "cancelled", cancelled_at: at}, _), do: at

  defp terminal_end(_co, shipments) do
    shipments.last_delivered_at_if_all_done
  end

  defp maybe_dt(nil), do: nil
  defp maybe_dt(%DateTime{} = dt), do: dt
  defp maybe_dt(%NaiveDateTime{} = ndt), do: DateTime.from_naive!(ndt, "Etc/UTC")

  defp seconds_between(%DateTime{} = a, %DateTime{} = b) do
    max(DateTime.diff(b, a, :second), 0)
  end

  defp seconds_between(_, _), do: 0

  defp min_or_nil([]), do: nil
  defp min_or_nil(list), do: Enum.min_by(list, & &1, DateTime)

  defp max_or_nil([]), do: nil
  defp max_or_nil(list), do: Enum.max_by(list, & &1, DateTime)

  defp render_code(nil, _id), do: nil

  defp render_code(company, id) do
    Backend.Numbering.render(id, company, "customer_order")
  end
end
