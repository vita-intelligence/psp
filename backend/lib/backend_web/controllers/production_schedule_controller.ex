defmodule BackendWeb.ProductionScheduleController do
  @moduledoc """
  Read-only feed for the production schedule page.

  One endpoint returns everything the calendar needs in a single
  round-trip:

    * Workstation groups for the row axis (active only).
    * MO step operations whose planned window overlaps the requested
      date range, restricted to approved + in_progress MOs at the
      chosen site.
    * Per-WSG, per-day working windows resolved through the
      precedence chain (WSG override → warehouse override → company
      default), plus holiday labels.

  Permission: `production.mo_view`. Scheduling actions (drag → patch
  step planned times) go through the existing per-step endpoint
  which has its own RBAC.
  """

  use BackendWeb, :controller

  alias Backend.Companies.Company
  alias Backend.Production
  alias Backend.Repo
  alias Backend.Warehouses.Warehouse
  alias BackendWeb.Errors
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "production.mo_view"

  def show(conn, params) do
    actor = conn.assigns.current_user

    with {:ok, warehouse} <- fetch_warehouse(actor, params["warehouse_id"]),
         {:ok, from_date, to_date} <- parse_range(params) do
      company = Repo.get!(Company, actor.company_id)
      groups = Production.list_workstation_groups_for_schedule(actor)
      operations = Production.list_schedule_operations(actor, warehouse, from_date, to_date)

      working_windows =
        Production.resolve_working_windows(groups, warehouse, company, from_date, to_date)

      json(conn, %{
        warehouse: %{
          id: warehouse.id,
          uuid: warehouse.uuid,
          name: warehouse.name,
          kind: warehouse.kind,
          timezone: warehouse.timezone
        },
        range: %{from: from_date, to: to_date},
        workstation_groups: Enum.map(groups, &Payloads.workstation_group_summary/1),
        operations: Enum.map(operations, &Payloads.schedule_operation/1),
        working_windows: Enum.map(working_windows, &windows_payload/1)
      })
    else
      {:error, :warehouse_required} ->
        unprocessable(conn, "warehouse_required", "Pick a production site to view the schedule.")

      {:error, :warehouse_not_found} ->
        not_found(conn, "Site not found.")

      {:error, :invalid_warehouse_id} ->
        unprocessable(conn, "invalid_warehouse_id", "Bad warehouse_id.")

      {:error, :invalid_range} ->
        unprocessable(
          conn,
          "invalid_range",
          "Pass from=YYYY-MM-DD and to=YYYY-MM-DD with from ≤ to."
        )
    end
  end

  defp windows_payload(%{group_id: id, days: days}) do
    %{
      group_id: id,
      days:
        Enum.map(days, fn d ->
          %{
            date: d.date,
            holiday_label: d.holiday_label,
            intervals:
              Enum.map(d.intervals, fn i ->
                %{open: i.open, close: i.close}
              end)
          }
        end)
    }
  end

  defp fetch_warehouse(_actor, nil),
    do: {:error, :warehouse_required}

  defp fetch_warehouse(actor, raw) do
    case Integer.parse(to_string(raw)) do
      {id, ""} ->
        case Repo.get(Warehouse, id) do
          %Warehouse{company_id: cid} = w when cid == actor.company_id -> {:ok, w}
          _ -> {:error, :warehouse_not_found}
        end

      _ ->
        {:error, :invalid_warehouse_id}
    end
  end

  defp parse_range(%{"from" => from_raw, "to" => to_raw}) do
    with {:ok, f} <- Date.from_iso8601(from_raw),
         {:ok, t} <- Date.from_iso8601(to_raw),
         true <- Date.compare(f, t) != :gt do
      {:ok, f, t}
    else
      _ -> {:error, :invalid_range}
    end
  end

  defp parse_range(_), do: {:error, :invalid_range}

  defp unprocessable(conn, code, detail) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(Errors.payload(code, detail, %{}))
  end

  defp not_found(conn, detail) do
    conn
    |> put_status(:not_found)
    |> json(Errors.payload("not_found", detail, %{}))
  end
end
