defmodule BackendWeb.IntegrationCleaningController do
  @moduledoc """
  Cleaning-complete callback from vita-performance.

    * ``POST /api/integration/workstations/:uuid/cleaning-complete/``

  Fired by vita-perf when an operator finishes a cleaning session on
  a personal-kiosk tablet. PSP is the compliance ledger — this endpoint
  is what turns "kiosk timer stopped" into audit-worthy state:

    1. Update `workstations.last_cleaning_at` = ended_at
       + recompute `next_cleaning_due_at` from the configured cadence.
    2. Drop a `note` event with `metadata.event_semantic = "cleaning_completed"`
       on every attached live piece of equipment so the equipment
       timeline reflects the clean.
    3. Broadcast `entity:workstation` so open detail pages refresh.
    4. Republish the cleaning form back to vita-perf so the mirror's
       `next_cleaning_due_at` gets the fresh date (fire-and-forget;
       silent-degrade like the rest of the publisher).

  Requires scope ``workstation:write:cleaning``.
  """

  use BackendWeb, :controller

  import Ecto.Query
  import BackendWeb.IntegrationScopePlug

  alias Backend.Broadcasts
  alias Backend.Equipment.{Equipment, Lifecycle, MaintenanceTasks}
  alias Backend.Forms.Publisher
  alias Backend.Production.Workstation
  alias Backend.Repo
  alias BackendWeb.Errors

  plug :require_integration_scope, "workstation:write:cleaning"
       when action == :complete

  action_fallback BackendWeb.FallbackController

  def complete(conn, %{"uuid" => ws_uuid} = params) do
    company_id = conn.assigns.current_company_id

    duration_seconds = parse_int(params["duration_seconds"])
    ended_at = parse_datetime(params["ended_at"]) || DateTime.utc_now()
    started_at = parse_datetime(params["started_at"])
    session_id = params["session_id"]
    worker_id = params["worker_id"]
    worker_name = params["worker_name"]

    with %Workstation{} = ws <-
           Repo.one(
             from w in Workstation,
               where: w.company_id == ^company_id and w.uuid == ^ws_uuid,
               preload: [equipment: :item]
           ) do
      next_due = compute_next_due(ws, ended_at)

      Repo.transaction(fn ->
        {1, _} =
          from(w in Workstation, where: w.id == ^ws.id)
          |> Repo.update_all(
            set: [
              last_cleaning_at: DateTime.truncate(ended_at, :second),
              next_cleaning_due_at: next_due,
              updated_at: DateTime.utc_now() |> DateTime.truncate(:second)
            ]
          )

        write_cleaning_events_for_equipment(
          ws,
          session_id: session_id,
          duration_seconds: duration_seconds,
          worker_id: worker_id,
          worker_name: worker_name,
          started_at: started_at,
          ended_at: ended_at
        )

        :ok
      end)
      |> case do
        {:ok, _} ->
          Broadcasts.entity_changed("workstation", ws.uuid, company_id, "cleaning_completed")

          # Reload with updated scalars + publish the cleaning form so
          # the vita-perf mirror gets the fresh next-due. Silent-degrade.
          ws = Repo.reload(ws)
          Publisher.publish_workstation(ws)

          conn
          |> put_status(:ok)
          |> json(%{
            workstation_uuid: ws.uuid,
            last_cleaning_at: ws.last_cleaning_at,
            next_cleaning_due_at: ws.next_cleaning_due_at,
            events_written: count_live_equipment(ws)
          })

        {:error, reason} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(
            Errors.payload(
              "cleaning_complete_failed",
              "Couldn't record the cleaning complete.",
              %{"reason" => inspect(reason)}
            )
          )
      end
    else
      nil ->
        conn
        |> put_status(:not_found)
        |> json(
          Errors.payload(
            "workstation_not_found",
            "No workstation with that uuid in your workspace."
          )
        )
    end
  end

  # ── helpers ──────────────────────────────────────────────────────

  defp compute_next_due(%Workstation{} = ws, %DateTime{} = ended_at) do
    base = DateTime.to_date(ended_at)

    case {ws.cleaning_periodicity, ws.cleaning_periodicity_interval} do
      {nil, nil} ->
        nil

      _ ->
        MaintenanceTasks.compute_next_due(
          base,
          ws.cleaning_periodicity,
          ws.cleaning_periodicity_interval
        )
    end
  end

  defp write_cleaning_events_for_equipment(%Workstation{} = ws, opts) do
    started_iso =
      case Keyword.get(opts, :started_at) do
        %DateTime{} = dt -> DateTime.to_iso8601(dt)
        _ -> nil
      end

    ended_iso =
      case Keyword.get(opts, :ended_at) do
        %DateTime{} = dt -> DateTime.to_iso8601(dt)
        _ -> nil
      end

    metadata = %{
      "event_semantic" => "cleaning_completed",
      "workstation_uuid" => ws.uuid,
      "workstation_name" => ws.name,
      "session_id" => Keyword.get(opts, :session_id),
      "duration_seconds" => Keyword.get(opts, :duration_seconds),
      "worker_id" => Keyword.get(opts, :worker_id),
      "worker_name" => Keyword.get(opts, :worker_name),
      "started_at" => started_iso,
      "ended_at" => ended_iso
    }

    reason =
      case Keyword.get(opts, :worker_name) do
        name when is_binary(name) and name != "" ->
          "Cleaned on #{ws.name} by #{name}"

        _ ->
          "Cleaned on #{ws.name}"
      end

    for %Equipment{} = eq <- live_equipment(ws) do
      # `record_event_in_transaction/3` writes the row inside the
      # current Repo transaction — safe to call from here.
      case Lifecycle.record_event_in_transaction(eq, "note", %{
             actor: nil,
             actor_kind: "integration",
             reason: reason,
             metadata: metadata
           }) do
        {:ok, _} -> :ok
        # Log-and-continue so one rejected event doesn't wipe the
        # whole batch (equipment may be in a weird state).
        {:error, _} -> :ok
      end
    end
  end

  defp live_equipment(%Workstation{equipment: %Ecto.Association.NotLoaded{}}), do: []

  defp live_equipment(%Workstation{equipment: list}) when is_list(list) do
    Enum.filter(list, fn %Equipment{status: s} ->
      s in ~w(received in_service)
    end)
  end

  defp count_live_equipment(%Workstation{} = ws) do
    ws = Repo.preload(ws, [:equipment])
    ws |> live_equipment() |> length()
  end

  defp parse_int(nil), do: nil
  defp parse_int(n) when is_integer(n), do: n
  defp parse_int(s) when is_binary(s) do
    case Integer.parse(s) do
      {n, ""} -> n
      _ -> nil
    end
  end

  defp parse_int(_), do: nil

  defp parse_datetime(nil), do: nil
  defp parse_datetime(%DateTime{} = dt), do: dt
  defp parse_datetime(s) when is_binary(s) do
    case DateTime.from_iso8601(s) do
      {:ok, dt, _} -> dt
      _ -> nil
    end
  end

  defp parse_datetime(_), do: nil
end
