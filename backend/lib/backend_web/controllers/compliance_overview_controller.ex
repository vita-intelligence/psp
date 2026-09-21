defmodule BackendWeb.ComplianceOverviewController do
  @moduledoc """
  Dashboard widget feed: overdue cleaning + maintenance across all
  workstations and equipment in the tenant.

  * ``GET /api/production/compliance-overview``

  Powers the "Overdue Cleaning & Maintenance" widget on the home
  dashboard. Every entity that has a ``next_*_due_at`` in the past
  contributes one row to its bucket; the widget renders four
  buckets (workstation cleaning / workstation maintenance /
  equipment cleaning / equipment maintenance) with counts + the
  top overdue rows for a quick jump.

  Read-gated by ``production.view`` — same as the workstation
  detail page. RBAC on the FE also hides the widget when the user
  can't visit the deep-linked pages.
  """

  use BackendWeb, :controller

  import Ecto.Query

  alias Backend.Equipment.Equipment
  alias Backend.Production.Workstation
  alias Backend.Repo
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "production.workstation_view" when action == :show

  action_fallback BackendWeb.FallbackController

  @preview_size 5

  def show(conn, _params) do
    company_id = conn.assigns.current_user.company_id
    today = Date.utc_today()

    ws_cleaning = overdue_workstations(company_id, :cleaning, today)
    ws_maintenance = overdue_workstations(company_id, :maintenance, today)
    eq_cleaning = overdue_equipment(company_id, :cleaning, today)
    eq_maintenance = overdue_equipment(company_id, :maintenance, today)

    json(conn, %{
      as_of: Date.to_iso8601(today),
      buckets: %{
        workstation_cleaning: bucket_payload(ws_cleaning, :cleaning),
        workstation_maintenance: bucket_payload(ws_maintenance, :maintenance),
        equipment_cleaning: bucket_payload(eq_cleaning, :cleaning),
        equipment_maintenance: bucket_payload(eq_maintenance, :maintenance)
      }
    })
  end

  # ── workstations ─────────────────────────────────────────────────

  defp overdue_workstations(company_id, :cleaning, today) do
    Repo.all(
      from w in Workstation,
        where:
          w.company_id == ^company_id and
            w.is_active == true and
            not is_nil(w.next_cleaning_due_at) and
            w.next_cleaning_due_at < ^today,
        select: %{
          uuid: w.uuid,
          name: w.name,
          due_at: w.next_cleaning_due_at,
          last_at: w.last_cleaning_at
        },
        order_by: [asc: w.next_cleaning_due_at]
    )
  end

  defp overdue_workstations(company_id, :maintenance, today) do
    Repo.all(
      from w in Workstation,
        where:
          w.company_id == ^company_id and
            w.is_active == true and
            not is_nil(w.next_maintenance_due_at) and
            w.next_maintenance_due_at < ^today,
        select: %{
          uuid: w.uuid,
          name: w.name,
          due_at: w.next_maintenance_due_at,
          last_at: w.last_maintenance_at
        },
        order_by: [asc: w.next_maintenance_due_at]
    )
  end

  # ── equipment ────────────────────────────────────────────────────
  #
  # Equipment cleaning uses ``next_cleaning_due_at`` (Date). Equipment
  # maintenance uses ``next_maintenance_at`` (utc_datetime). Two
  # different types — but same conceptual "past today = overdue".

  defp overdue_equipment(company_id, :cleaning, today) do
    Repo.all(
      from e in Equipment,
        where:
          e.company_id == ^company_id and
            e.status not in ["retired", "disposed", "canceled"] and
            not is_nil(e.next_cleaning_due_at) and
            e.next_cleaning_due_at < ^today,
        preload: [:item],
        order_by: [asc: e.next_cleaning_due_at]
    )
    |> Enum.map(fn e ->
      %{
        uuid: e.uuid,
        name: equipment_display_name(e),
        due_at: e.next_cleaning_due_at,
        last_at: e.last_cleaning_at
      }
    end)
  end

  defp overdue_equipment(company_id, :maintenance, today) do
    end_of_today =
      case DateTime.new(today, ~T[23:59:59], "Etc/UTC") do
        {:ok, dt} -> dt
        _ -> DateTime.utc_now()
      end

    Repo.all(
      from e in Equipment,
        where:
          e.company_id == ^company_id and
            e.status not in ["retired", "disposed", "canceled"] and
            not is_nil(e.next_maintenance_at) and
            e.next_maintenance_at < ^end_of_today,
        preload: [:item],
        order_by: [asc: e.next_maintenance_at]
    )
    |> Enum.map(fn e ->
      %{
        uuid: e.uuid,
        name: equipment_display_name(e),
        due_at:
          case e.next_maintenance_at do
            %DateTime{} = dt -> DateTime.to_date(dt)
            _ -> nil
          end,
        last_at: e.last_maintenance_at
      }
    end)
  end

  # ── output shape ─────────────────────────────────────────────────

  defp bucket_payload(rows, kind) do
    %{
      count: length(rows),
      kind: to_string(kind),
      preview: rows |> Enum.take(@preview_size)
    }
  end

  defp equipment_display_name(%Equipment{item: item} = e) do
    base =
      cond do
        match?(%_{}, item) && item.name && item.name != "" -> item.name
        e.model && e.model != "" -> "#{e.manufacturer} #{e.model}" |> String.trim()
        e.manufacturer && e.manufacturer != "" -> e.manufacturer
        true -> "Equipment"
      end

    if e.serial_number && e.serial_number != "" do
      "#{base} · #{e.serial_number}"
    else
      base
    end
  end
end
