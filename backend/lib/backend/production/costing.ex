defmodule Backend.Production.Costing do
  @moduledoc """
  Cost roll-up primitives shared by the per-MO breakdown endpoint and
  the customer-order-wide project cost card.

  Design notes:

    * Labour uses `Backend.HR.wage_at/2` snapshotted at
      `session.started_at` — a wage change mid-MO doesn't retroactively
      rewrite labour on sessions that ran before the change.
    * Machine cost uses the workstation's current `hourly_rate` — same
      approach the operator sees on the workstation form. Wage-style
      time-slicing for machine rates is a follow-up.
    * For **live** UX (sessions still running), an active session's
      duration is measured from `started_at` to `DateTime.utc_now/0`
      so the wizard's "cost so far" ticks up as the kiosk clock runs.
      Completed / verified sessions are unchanged.
    * Materials sum the `MOBookings` × `Lot.unit_cost` product, same
      shape as the phase 7 endpoint.

  Public entry points:

    * `mo_cost_breakdown/2` — one MO, same response the existing
      `MOCostBreakdownController` returns today (delegates here now).
    * `customer_order_cost_breakdown/2` — walks the CO's MO tree via
      the same recursive CTE as
      `Backend.Production.list_sessions_for_customer_order/2` and
      rolls MO breakdowns up into a project total.
  """

  import Ecto.Query

  alias Backend.HR
  alias Backend.HR.Employee
  alias Backend.Production.{
    ManufacturingOrder,
    ManufacturingOrderBooking,
    ManufacturingOrderStep,
    Workstation,
    WorkstationSession
  }
  alias Backend.Repo
  alias Backend.Stock.Lot

  # ---------- Public: per-MO ----------

  @doc """
  One MO's cost breakdown. `id_or_uuid` accepts either the integer PK
  or the UUID so both the existing controller (UUID param) and the
  CO-wide roll-up (iterates ids) can call in cheaply.

  Returns the same map shape `MOCostBreakdownController.show/2` used
  to build inline. The shape MUST NOT change without a coordinated FE
  release — the phase 7 endpoint is public API.
  """
  def mo_cost_breakdown(company_id, id_or_uuid)

  def mo_cost_breakdown(company_id, uuid) when is_binary(uuid) do
    mo =
      Repo.one(
        from m in ManufacturingOrder,
          where: m.company_id == ^company_id and m.uuid == ^uuid,
          preload: [:item, steps: [:workstation_group]]
      )

    if mo, do: build_mo_breakdown(mo, company_id), else: nil
  end

  def mo_cost_breakdown(company_id, id) when is_integer(id) do
    mo =
      Repo.one(
        from m in ManufacturingOrder,
          where: m.company_id == ^company_id and m.id == ^id,
          preload: [:item, steps: [:workstation_group]]
      )

    if mo, do: build_mo_breakdown(mo, company_id), else: nil
  end

  # ---------- Public: CO-wide ----------

  @doc """
  Every MO in the CO's tree (top-level + descendants via
  `parent_mo_id`) rolled into a project-level cost summary. Mirrors
  the recursive CTE in
  `Backend.Production.list_sessions_for_customer_order/2`.
  """
  def customer_order_cost_breakdown(company_id, co_id)
      when is_integer(company_id) and is_integer(co_id) do
    co =
      Repo.one(
        from c in Backend.CustomerOrders.CustomerOrder,
          where: c.company_id == ^company_id and c.id == ^co_id,
          preload: [:company]
      )

    if is_nil(co) do
      nil
    else
      mo_ids = fetch_mo_tree_ids(company_id, co_id)
      company = co.company

      mo_summaries =
        mo_ids
        |> Enum.map(fn id -> mo_cost_breakdown(company_id, id) end)
        |> Enum.reject(&is_nil/1)
        |> Enum.map(fn br -> summarise_mo_for_co(br, company) end)

      totals = sum_co_totals(mo_summaries)
      active_seconds = sum_active_labour_seconds(mo_ids, company_id)
      by_machine = compute_by_machine(mo_ids, company_id)

      %{
        customer_order: %{
          uuid: co.uuid,
          code: render_code(company, co.id, "customer_order")
        },
        mos: mo_summaries,
        totals: Map.put(totals, :active_labour_running_seconds, active_seconds),
        by_machine: by_machine,
        currency_code: (company && company.currency_code) || co.currency_code || "GBP",
        generated_at: DateTime.utc_now()
      }
    end
  end

  # Per-machine roll-up across every session in the CO's MO tree.
  #
  # Walks each session, accumulates hours against the session's
  # workstation, then attributes those hours × rate to every active
  # rate-enabled machine attached to that workstation. Machines with
  # zero contribution are dropped so the FE doesn't render dead rows
  # for stations that never ran.
  defp compute_by_machine([], _company_id), do: []

  defp compute_by_machine(mo_ids, company_id) do
    sessions =
      Repo.all(
        from s in WorkstationSession,
          join: step in assoc(s, :manufacturing_order_step),
          where:
            s.company_id == ^company_id and
              step.manufacturing_order_id in ^mo_ids,
          preload: [workstation: :machines]
      )

    # workstation_id → total session hours across the CO tree
    hours_by_ws =
      Enum.reduce(sessions, %{}, fn session, acc ->
        h = session_duration_hours(session)

        case session.workstation do
          %Workstation{id: ws_id} ->
            Map.update(acc, ws_id, h, fn prev -> Decimal.add(prev, h) end)

          _ ->
            acc
        end
      end)

    # For every workstation that had any hours, iterate its machines
    # and produce one row per (machine, workstation) pair. A machine
    # can only belong to one workstation today (belongs_to), so this
    # is really "one row per rate-enabled machine that saw activity".
    ws_by_id =
      Enum.reduce(sessions, %{}, fn session, acc ->
        case session.workstation do
          %Workstation{id: ws_id} = ws -> Map.put(acc, ws_id, ws)
          _ -> acc
        end
      end)

    for {ws_id, hours} <- hours_by_ws,
        %Workstation{} = ws <- [Map.get(ws_by_id, ws_id)],
        is_list(ws.machines),
        machine <- ws.machines,
        machine.is_active,
        machine.hourly_rate_enabled,
        match?(%Decimal{}, machine.hourly_rate) do
      cost = Decimal.mult(machine.hourly_rate, hours)

      %{
        uuid: machine.uuid,
        name: machine.name,
        asset_tag: machine.asset_tag,
        workstation_uuid: ws.uuid,
        workstation_name: ws.name,
        hourly_rate: to_string(machine.hourly_rate),
        hours: to_string(Decimal.round(hours, 4)),
        cost: cost
      }
    end
    |> Enum.sort_by(fn r -> Decimal.to_float(r.cost) end, :desc)
  end

  # ---------- Internals: MO breakdown ----------

  defp build_mo_breakdown(%ManufacturingOrder{} = mo, company_id) do
    steps_with_costs =
      for step <- mo.steps || [] do
        compute_step_costs(step, company_id)
      end

    materials = compute_materials(mo.id)
    totals = sum_totals(steps_with_costs, materials)

    %{
      manufacturing_order: %{
        uuid: mo.uuid,
        status: mo.status,
        quantity: to_string(mo.quantity),
        quantity_produced: mo.quantity_produced && to_string(mo.quantity_produced),
        item_name: mo.item && mo.item.name
      },
      steps: steps_with_costs,
      materials: materials,
      totals: totals,
      per_unit: per_unit_totals(totals, mo.quantity_produced || mo.quantity),
      _meta: %{
        non_mo_overhead_policy: "standalone_only",
        currency_code: "GBP",
        generated_at: DateTime.utc_now()
      }
    }
  end

  defp compute_step_costs(%ManufacturingOrderStep{} = step, company_id) do
    sessions =
      Repo.all(
        from s in WorkstationSession,
          where: s.manufacturing_order_step_id == ^step.id,
          order_by: [asc: s.started_at],
          preload: [workstation: [:workstation_group, :machines]]
      )

    session_rows =
      for session <- sessions do
        labour = compute_labour_cost(session, company_id)
        machine = compute_machine_cost(session, session.workstation)

        %{
          uuid: session.uuid,
          activity_kind: session.activity_kind,
          started_at: session.started_at,
          finished_at: session.finished_at,
          duration_hours: session_duration_hours(session),
          workers: length(session.employee_uuids),
          quantity_produced: session.quantity_produced && to_string(session.quantity_produced),
          quantity_rejected: session.quantity_rejected && to_string(session.quantity_rejected),
          labour_cost: labour,
          machine_cost: machine,
          total_cost: sum_decimals([labour, machine])
        }
      end

    step_labour = sum_decimals(Enum.map(session_rows, & &1.labour_cost))
    step_machine = sum_decimals(Enum.map(session_rows, & &1.machine_cost))

    %{
      uuid: step.uuid,
      sort_order: step.sort_order,
      name: Map.get(step, :name) || Map.get(step, :operation_name),
      workstation_name: step.workstation_group && step.workstation_group.name,
      sessions: session_rows,
      totals: %{
        labour_cost: step_labour,
        machine_cost: step_machine,
        material_cost: nil,
        rejected_material_cost: nil,
        total_cost: sum_decimals([step_labour, step_machine])
      }
    }
  end

  # ---------- Labour ----------

  defp compute_labour_cost(%WorkstationSession{employee_uuids: []}, _), do: Decimal.new(0)
  defp compute_labour_cost(%WorkstationSession{started_at: nil}, _), do: Decimal.new(0)

  defp compute_labour_cost(%WorkstationSession{} = session, company_id) do
    duration = session_duration_hours(session)

    if Decimal.compare(duration, Decimal.new(0)) == :eq do
      Decimal.new(0)
    else
      Enum.reduce(session.employee_uuids, Decimal.new(0), fn uuid, acc ->
        with %Employee{} = employee <- HR.get_employee(company_id, to_string(uuid)),
             %{hourly_rate: rate} <- HR.wage_at(employee, session.started_at) do
          Decimal.add(acc, Decimal.mult(rate, duration))
        else
          _ -> acc
        end
      end)
    end
  end

  # ---------- Machine ----------

  defp compute_machine_cost(_session, nil), do: Decimal.new(0)

  defp compute_machine_cost(%WorkstationSession{} = session, %Workstation{} = ws) do
    duration = session_duration_hours(session)
    rate = effective_machine_rate(ws)

    case {rate, duration} do
      {%Decimal{} = r, %Decimal{} = d} -> Decimal.mult(r, d)
      _ -> Decimal.new(0)
    end
  end

  # Cost cascade:
  #   1. SUM of every active machine attached to the station where the
  #      session ran (rate-enabled + is_active only). A station with 3
  #      mixers rate-enabled at £2/h contributes £6/h.
  #   2. If no machines contribute, fall back to the workstation's own
  #      override.
  #   3. Otherwise, fall back to the workstation_group's rate.
  defp effective_machine_rate(%Workstation{machines: machines} = ws) when is_list(machines) do
    sum =
      machines
      |> Enum.filter(fn m ->
        m.is_active && m.hourly_rate_enabled && match?(%Decimal{}, m.hourly_rate)
      end)
      |> Enum.reduce(Decimal.new(0), fn m, acc -> Decimal.add(acc, m.hourly_rate) end)

    if Decimal.compare(sum, Decimal.new(0)) == :gt do
      sum
    else
      fallback_rate(ws)
    end
  end

  defp effective_machine_rate(%Workstation{} = ws), do: fallback_rate(ws)

  defp fallback_rate(%Workstation{hourly_rate_enabled: true, hourly_rate: %Decimal{} = r}),
    do: r

  defp fallback_rate(%Workstation{workstation_group: %{hourly_rate_enabled: true, hourly_rate: %Decimal{} = r}}),
    do: r

  defp fallback_rate(_), do: nil

  # ---------- Materials ----------

  defp compute_materials(mo_id) do
    bookings =
      Repo.all(
        from b in ManufacturingOrderBooking,
          where: b.manufacturing_order_id == ^mo_id,
          left_join: l in Lot, on: b.stock_lot_id == l.id,
          left_join: i in assoc(l, :item),
          preload: [stock_lot: {l, item: i}]
      )

    rows =
      for b <- bookings do
        lot = b.stock_lot
        unit_cost = lot && lot.unit_cost
        consumed_qty = b.consumed_quantity || Decimal.new(0)
        planned_qty = b.quantity || Decimal.new(0)

        consumed_cost = mult_or_zero(unit_cost, consumed_qty)
        planned_cost = mult_or_zero(unit_cost, planned_qty)

        %{
          booking_uuid: b.uuid,
          lot_uuid: lot && lot.uuid,
          item_name: lot && lot.item && lot.item.name,
          planned_quantity: to_string(planned_qty),
          consumed_quantity: to_string(consumed_qty),
          unit_cost: unit_cost && to_string(unit_cost),
          planned_cost: planned_cost,
          consumed_cost: consumed_cost,
          # Backwards-compat alias for callers still reading .line_cost.
          line_cost: consumed_cost
        }
      end

    consumed_total = sum_decimals(Enum.map(rows, & &1.consumed_cost))
    planned_total = sum_decimals(Enum.map(rows, & &1.planned_cost))

    %{
      lines: rows,
      consumed_cost: consumed_total,
      planned_cost: planned_total,
      # Truthful accrued spend (unchanged semantics for existing callers).
      total_cost: consumed_total
    }
  end

  defp mult_or_zero(%Decimal{} = uc, %Decimal{} = q), do: Decimal.mult(uc, q)
  defp mult_or_zero(_, _), do: Decimal.new(0)

  # ---------- helpers ----------

  # Live-cost fix: when the session is still running (`finished_at`
  # is nil AND status is `active`), measure from `started_at` to now
  # so labour ticks up in real time as the kiosk clock runs. Any other
  # state where `finished_at` is nil (e.g. abandoned) stays at zero.
  def session_duration_hours(%WorkstationSession{started_at: nil}), do: Decimal.new(0)

  def session_duration_hours(%WorkstationSession{finished_at: nil, status: "active", started_at: s}) do
    seconds = DateTime.diff(DateTime.utc_now(), s, :second)
    seconds |> max(0) |> Decimal.new() |> Decimal.div(Decimal.new(3600)) |> Decimal.round(4)
  end

  def session_duration_hours(%WorkstationSession{finished_at: nil}), do: Decimal.new(0)

  def session_duration_hours(%WorkstationSession{started_at: s, finished_at: f}) do
    seconds = DateTime.diff(f, s, :second)
    seconds |> Decimal.new() |> Decimal.div(Decimal.new(3600)) |> Decimal.round(4)
  end

  def sum_decimals(list) do
    list
    |> Enum.reject(&is_nil/1)
    |> Enum.reduce(Decimal.new(0), fn v, acc ->
      Decimal.add(acc, if(is_struct(v, Decimal), do: v, else: Decimal.new(0)))
    end)
  end

  defp sum_totals(step_rows, materials) do
    labour = sum_decimals(Enum.map(step_rows, & &1.totals.labour_cost))
    machine = sum_decimals(Enum.map(step_rows, & &1.totals.machine_cost))
    consumed_material = materials.consumed_cost
    planned_material = materials.planned_cost

    %{
      labour_cost: labour,
      machine_cost: machine,
      # `material_cost` = truthful accrued (consumed × unit_cost).
      # `planned_material_cost` = forecast if everything requested is
      # consumed at the booked lot's unit cost. Both flow to FE so the
      # wizard shows "£X consumed / £Y planned" side by side.
      material_cost: consumed_material,
      planned_material_cost: planned_material,
      rejected_material_cost: nil,
      total_cost: sum_decimals([labour, machine, consumed_material]),
      planned_total_cost: sum_decimals([labour, machine, planned_material])
    }
  end

  defp per_unit_totals(totals, %Decimal{} = qty) do
    if Decimal.compare(qty, Decimal.new(0)) == :gt do
      %{
        labour_cost: safe_div(totals.labour_cost, qty),
        machine_cost: safe_div(totals.machine_cost, qty),
        material_cost: safe_div(totals.material_cost, qty),
        total_cost: safe_div(totals.total_cost, qty),
        quantity: to_string(qty)
      }
    else
      nil
    end
  end

  defp per_unit_totals(_totals, _), do: nil

  defp safe_div(nil, _), do: nil

  defp safe_div(%Decimal{} = a, %Decimal{} = b) do
    if Decimal.compare(b, Decimal.new(0)) == :gt do
      Decimal.div(a, b) |> Decimal.round(4)
    else
      nil
    end
  end

  # ---------- CO-tree helpers ----------

  # Same recursive CTE the sessions endpoint uses; kept co-located so
  # the two callers can't drift apart on how the tree is walked.
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

    %{rows: id_rows} = Repo.query!(tree_query, [co_id, company_id])
    Enum.map(id_rows, &List.first/1)
  end

  defp summarise_mo_for_co(%{manufacturing_order: mo, totals: totals, per_unit: per_unit}, company) do
    id =
      case Repo.one(
             from m in ManufacturingOrder,
               where: m.uuid == ^mo.uuid,
               select: m.id
           ) do
        nil -> nil
        v -> v
      end

    %{
      uuid: mo.uuid,
      code: id && render_code(company, id, "manufacturing_order"),
      item_name: mo.item_name,
      status: mo.status,
      quantity: mo.quantity,
      quantity_produced: mo.quantity_produced,
      per_unit: normalise_per_unit(per_unit),
      totals: %{
        labour_cost: totals.labour_cost,
        machine_cost: totals.machine_cost,
        material_cost: totals.material_cost,
        planned_material_cost: Map.get(totals, :planned_material_cost),
        rejected_material_cost: totals.rejected_material_cost,
        total_cost: totals.total_cost,
        planned_total_cost: Map.get(totals, :planned_total_cost)
      }
    }
  end

  defp normalise_per_unit(nil) do
    %{labour: nil, machine: nil, material: nil, total: nil}
  end

  defp normalise_per_unit(pu) do
    %{
      labour: Map.get(pu, :labour_cost),
      machine: Map.get(pu, :machine_cost),
      material: Map.get(pu, :material_cost),
      total: Map.get(pu, :total_cost)
    }
  end

  defp sum_co_totals(mo_summaries) do
    labour = sum_decimals(Enum.map(mo_summaries, & &1.totals.labour_cost))
    machine = sum_decimals(Enum.map(mo_summaries, & &1.totals.machine_cost))
    material = sum_decimals(Enum.map(mo_summaries, & &1.totals.material_cost))
    planned_material = sum_decimals(Enum.map(mo_summaries, & &1.totals.planned_material_cost))
    rejected = sum_decimals(Enum.map(mo_summaries, & &1.totals.rejected_material_cost))

    %{
      labour_cost: labour,
      machine_cost: machine,
      material_cost: material,
      planned_material_cost: planned_material,
      rejected_material_cost: rejected,
      total_cost: sum_decimals([labour, machine, material]),
      planned_total_cost: sum_decimals([labour, machine, planned_material])
    }
  end

  # How many wall-clock seconds are currently accumulating on running
  # sessions across this CO's MO tree. Powers the "live" pill on the
  # cost card + drives the periodic router.refresh() on the client.
  defp sum_active_labour_seconds([], _company_id), do: 0

  defp sum_active_labour_seconds(mo_ids, company_id) do
    now = DateTime.utc_now()

    starts =
      Repo.all(
        from s in WorkstationSession,
          join: step in assoc(s, :manufacturing_order_step),
          where:
            s.company_id == ^company_id and
              s.status == "active" and
              is_nil(s.finished_at) and
              step.manufacturing_order_id in ^mo_ids,
          select: s.started_at
      )

    starts
    |> Enum.reject(&is_nil/1)
    |> Enum.map(fn started -> max(DateTime.diff(now, started, :second), 0) end)
    |> Enum.sum()
  end

  defp render_code(nil, _id, _key), do: nil

  defp render_code(company, id, key) do
    Backend.Numbering.render(id, company, key)
  end
end
