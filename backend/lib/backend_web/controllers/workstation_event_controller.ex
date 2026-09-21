defmodule BackendWeb.WorkstationEventController do
  @moduledoc """
  Read-side for the workstation audit-log (cleaning + maintenance).

  Powers the "Cleaning & Maintenance" section on the workstation
  detail page. Paginated, filterable by `kind`, tenant-scoped.

  Requires `production.view` — same read gate as the workstation
  detail page itself.
  """

  use BackendWeb, :controller

  import Ecto.Query

  alias Backend.Broadcasts
  alias Backend.Production.{Workstation, WorkstationEvent}
  alias Backend.Repo
  alias BackendWeb.Errors
  alias BackendWeb.ListQueries
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "production.workstation_view" when action == :index

  action_fallback BackendWeb.FallbackController

  @default_limit 20
  @max_limit 100

  def index(conn, %{"workstation_id" => ws_uuid} = params) do
    company_id = conn.assigns.current_user.company_id

    case Repo.one(
           from w in Workstation,
             where: w.company_id == ^company_id and w.uuid == ^ws_uuid
         ) do
      nil ->
        conn
        |> put_status(:not_found)
        |> json(
          Errors.payload(
            "workstation_not_found",
            "No workstation with that uuid in your workspace."
          )
        )

      %Workstation{} = ws ->
        kinds = parse_kinds(params["kind"])
        limit = parse_limit(params["limit"])
        cursor = params["cursor"]

        base =
          from e in WorkstationEvent,
            where: e.workstation_id == ^ws.id and e.company_id == ^company_id

        base =
          if kinds == [] do
            base
          else
            from e in base, where: e.kind in ^kinds
          end

        # Keyset paginate on (started_at desc, id desc) so a hot
        # workstation's history scrolls cheaply.
        sort = {:started_at, :desc}
        base = ListQueries.apply_sort(base, sort, [:started_at, :id], sort)

        {rows, next_cursor} = ListQueries.paginate(Repo, base, sort, limit, cursor)

        json(conn, %{
          items: Enum.map(rows, &payload/1),
          next_cursor: next_cursor,
          workstation: %{
            id: ws.id,
            uuid: ws.uuid,
            name: ws.name,
            last_cleaning_at: ws.last_cleaning_at,
            next_cleaning_due_at: ws.next_cleaning_due_at,
            last_maintenance_at: ws.last_maintenance_at,
            next_maintenance_due_at: ws.next_maintenance_due_at,
            cleaning_periodicity: ws.cleaning_periodicity,
            cleaning_periodicity_interval: ws.cleaning_periodicity_interval,
            maintenance_periodicity: ws.maintenance_periodicity,
            maintenance_periodicity_interval: ws.maintenance_periodicity_interval
          }
        })
    end
  end

  # Parse `?kind=cleaning_completed,maintenance_completed` — accepts
  # a single or comma-separated list. Unknown values are dropped
  # so a bad query param never 500's the read.
  defp parse_kinds(nil), do: []

  defp parse_kinds(s) when is_binary(s) do
    allowed = WorkstationEvent.kinds()

    s
    |> String.split(",", trim: true)
    |> Enum.map(&String.trim/1)
    |> Enum.filter(&(&1 in allowed))
  end

  defp parse_kinds(_), do: []

  defp parse_limit(nil), do: @default_limit

  defp parse_limit(v) do
    case v |> to_string() |> Integer.parse() do
      {n, ""} when n > 0 and n <= @max_limit -> n
      _ -> @default_limit
    end
  end

  # Wire shape for the FE row renderer. Kept flat so a shared
  # audit-row component can render workstation + equipment audit
  # events with the same primitives (kind, when, who, duration,
  # form response).
  defp payload(%WorkstationEvent{} = e) do
    %{
      id: e.id,
      uuid: e.uuid,
      kind: e.kind,
      started_at: e.started_at,
      ended_at: e.ended_at,
      duration_seconds: e.duration_seconds,
      worker_external_id: e.worker_external_id,
      worker_name: e.worker_name,
      form_response_uuid: e.form_response_uuid,
      vp_session_id: e.vp_session_id,
      vp_shift_id: e.vp_shift_id,
      reason: e.reason,
      metadata: e.metadata,
      inserted_at: e.inserted_at
    }
  end
end
