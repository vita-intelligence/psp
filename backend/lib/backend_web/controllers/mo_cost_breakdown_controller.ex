defmodule BackendWeb.MOCostBreakdownController do
  @moduledoc """
  `GET /api/production/manufacturing-orders/:uuid/cost-breakdown`

  Aggregates the actual costs incurred on a manufacturing order,
  broken down by step and rolled up to the MO total. Labour uses
  point-in-time wage lookups against `Backend.HR.EmployeeWage.wage_at/2`
  so a wage change mid-MO doesn't retroactively rewrite the labour
  cost of sessions that ran before the change.

  Material and rejected-material cost are stubbed as `nil` in this
  first cut — they hang off the existing `ManufacturingOrderBooking`
  → `StockLot.unit_cost` path and land in a follow-up commit that
  won't touch this endpoint's shape.

  Non-MO allocation policy (`:pool_prorata` / `:standalone_only`
  / `:ignore`) is not yet consulted — it defaults to `:standalone_only`
  and is exposed as `_meta.non_mo_overhead_policy` on the response
  so the frontend can label its "off-MO time isn't in this total"
  disclaimer accurately.
  """

  use BackendWeb, :controller

  import Ecto.Query

  alias Backend.HR
  alias Backend.HR.Employee
  alias Backend.Production.{ManufacturingOrder, ManufacturingOrderBooking, ManufacturingOrderStep, Workstation, WorkstationSession}
  alias Backend.Stock.Lot
  alias Backend.Repo
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "production.mo_view"

  action_fallback BackendWeb.FallbackController

  def show(conn, %{"id" => uuid}) do
    company_id = conn.assigns.current_user.company_id

    with %ManufacturingOrder{} = mo <-
           Repo.one(
             from m in ManufacturingOrder,
               where: m.company_id == ^company_id and m.uuid == ^uuid,
               preload: [
                 :item,
                 steps: [:workstation]
               ]
           ) do
      steps_with_costs =
        for step <- mo.steps || [] do
          compute_step_costs(step, company_id)
        end

      materials = compute_materials(mo.id)

      totals = sum_totals(steps_with_costs, materials)

      json(conn, %{
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
        per_unit:
          per_unit_totals(totals, mo.quantity_produced || mo.quantity),
        _meta: %{
          non_mo_overhead_policy: "standalone_only",
          currency_code: (mo.item && Map.get(mo, :currency_code)) || "GBP",
          generated_at: DateTime.utc_now()
        }
      })
    else
      nil -> {:error, :not_found}
    end
  end

  # ---- Materials ----

  defp compute_materials(mo_id) do
    bookings =
      Repo.all(
        from b in ManufacturingOrderBooking,
          where: b.manufacturing_order_id == ^mo_id,
          left_join: l in Lot, on: b.lot_id == l.id,
          left_join: i in assoc(l, :item),
          preload: [lot: {l, item: i}]
      )

    rows =
      for b <- bookings do
        lot = b.lot
        unit_cost = lot && lot.unit_cost
        qty = b.consumed_quantity || Decimal.new(0)

        line_cost =
          case {unit_cost, qty} do
            {%Decimal{} = uc, %Decimal{} = q} -> Decimal.mult(uc, q)
            _ -> Decimal.new(0)
          end

        %{
          booking_uuid: b.uuid,
          lot_uuid: lot && lot.uuid,
          item_name: lot && lot.item && lot.item.name,
          consumed_quantity: to_string(qty),
          unit_cost: unit_cost && to_string(unit_cost),
          line_cost: line_cost
        }
      end

    total = sum_decimals(Enum.map(rows, & &1.line_cost))

    %{lines: rows, total_cost: total}
  end

  # -----------------------------------------------------------------

  defp compute_step_costs(%ManufacturingOrderStep{} = step, company_id) do
    sessions =
      Repo.all(
        from s in WorkstationSession,
          where: s.manufacturing_order_step_id == ^step.id,
          order_by: [asc: s.started_at]
      )

    session_rows =
      for session <- sessions do
        labour = compute_labour_cost(session, company_id)
        machine = compute_machine_cost(session, step.workstation)

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
      workstation_name: step.workstation && step.workstation.name,
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

  # ---- Labour ----

  defp compute_labour_cost(%WorkstationSession{employee_uuids: []}, _), do: Decimal.new(0)
  defp compute_labour_cost(%WorkstationSession{started_at: nil}, _), do: Decimal.new(0)

  defp compute_labour_cost(%WorkstationSession{} = session, company_id) do
    duration = session_duration_hours(session)

    if duration == Decimal.new(0) do
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

  # ---- Machine ----

  defp compute_machine_cost(_session, nil), do: Decimal.new(0)

  defp compute_machine_cost(%WorkstationSession{} = session, %Workstation{} = ws) do
    duration = session_duration_hours(session)
    rate = if ws.hourly_rate_enabled, do: ws.hourly_rate, else: nil

    case {rate, duration} do
      {%Decimal{} = r, %Decimal{} = d} -> Decimal.mult(r, d)
      _ -> Decimal.new(0)
    end
  end

  # ---- helpers ----

  defp session_duration_hours(%WorkstationSession{started_at: nil}), do: Decimal.new(0)
  defp session_duration_hours(%WorkstationSession{finished_at: nil}), do: Decimal.new(0)

  defp session_duration_hours(%WorkstationSession{started_at: s, finished_at: f}) do
    seconds = DateTime.diff(f, s, :second)
    seconds |> Decimal.new() |> Decimal.div(Decimal.new(3600)) |> Decimal.round(4)
  end

  defp sum_decimals(list) do
    list
    |> Enum.reject(&is_nil/1)
    |> Enum.reduce(Decimal.new(0), fn v, acc ->
      Decimal.add(acc, if(is_struct(v, Decimal), do: v, else: Decimal.new(0)))
    end)
  end

  defp sum_totals(step_rows, materials) do
    labour = sum_decimals(Enum.map(step_rows, & &1.totals.labour_cost))
    machine = sum_decimals(Enum.map(step_rows, & &1.totals.machine_cost))
    material = materials.total_cost

    %{
      labour_cost: labour,
      machine_cost: machine,
      material_cost: material,
      rejected_material_cost: nil,
      total_cost: sum_decimals([labour, machine, material])
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
end
