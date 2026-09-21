defmodule BackendWeb.IntegrationSessionCompleteController do
  @moduledoc """
  Unified session-complete callback from vita-performance for
  cleaning + maintenance sessions.

  * ``POST /api/integration/workstations/:uuid/session-complete/``

  Fired by vita-perf when an operator finishes a cleaning **or**
  maintenance session on a personal-kiosk tablet. PSP is the
  compliance ledger — this endpoint turns "kiosk timer stopped"
  into audit-worthy state:

    1. Write an audit event row on the correct table:
       * ``equipment_events`` (kind = ``cleaning_completed`` /
         ``maintenance_completed``) when the session was scoped to
         a specific machine via ``equipment_uuid``
       * ``workstation_events`` otherwise
    2. Bump the matching cadence scalars on the same row so due-
       soon queries + kiosk chips reflect the fresh completion.
    3. Broadcast ``entity:workstation`` (or ``entity:equipment``)
       so open detail pages refresh.
    4. Republish the workstation to vita-perf so its mirror gets
       the fresh next-due date. Silent-degrade — a stale mirror
       fixes itself on the next reconciler sweep.

  Legacy ``cleaning-complete`` callback still lives on
  ``BackendWeb.IntegrationCleaningController`` — vita-perf's older
  release still points there. The unified endpoint is what new
  builds hit; both write to the new audit tables so the read side
  doesn't care which callback landed the row.

  Requires scope ``workstation:write:cleaning``.
  """

  use BackendWeb, :controller

  import Ecto.Query
  import BackendWeb.IntegrationScopePlug

  alias Backend.Broadcasts
  alias Backend.Equipment.{Equipment, MaintenanceTasks}
  alias Backend.Equipment.Event, as: EquipmentEvent
  alias Backend.Forms.Publisher
  alias Backend.Production.{Workstation, WorkstationEvent}
  alias Backend.Repo
  alias BackendWeb.Errors

  plug :require_integration_scope, "workstation:write:cleaning"
       when action == :session_complete

  action_fallback BackendWeb.FallbackController

  @allowed_kinds ~w(cleaning maintenance)

  def session_complete(conn, %{"uuid" => ws_uuid} = params) do
    company_id = conn.assigns.current_company_id

    kind = params["kind"]
    equipment_uuid = params["equipment_uuid"]
    session_id = params["session_id"]
    worker_id = params["worker_id"]
    worker_name = params["worker_name"]
    worker_uuid = params["worker_uuid"]
    duration_seconds = parse_int(params["duration_seconds"])
    ended_at = parse_datetime(params["ended_at"]) || DateTime.utc_now()
    started_at = parse_datetime(params["started_at"]) || ended_at
    shift_id = parse_int(params["shift_id"])
    form_response_uuids = params["form_response_uuids"] || []

    cond do
      kind not in @allowed_kinds ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "invalid_session_kind",
            "`kind` must be one of #{inspect(@allowed_kinds)}."
          )
        )

      true ->
        with %Workstation{} = ws <-
               Repo.one(
                 from w in Workstation,
                   where: w.company_id == ^company_id and w.uuid == ^ws_uuid
               ) do
          if is_binary(equipment_uuid) and equipment_uuid != "" do
            handle_equipment_scoped(
              conn,
              ws,
              equipment_uuid,
              kind,
              %{
                session_id: session_id,
                duration_seconds: duration_seconds,
                started_at: started_at,
                ended_at: ended_at,
                worker_id: worker_id,
                worker_name: worker_name,
                worker_uuid: worker_uuid,
                shift_id: shift_id,
                form_response_uuids: form_response_uuids
              }
            )
          else
            handle_workstation_scoped(
              conn,
              ws,
              kind,
              %{
                session_id: session_id,
                duration_seconds: duration_seconds,
                started_at: started_at,
                ended_at: ended_at,
                worker_id: worker_id,
                worker_name: worker_name,
                worker_uuid: worker_uuid,
                shift_id: shift_id,
                form_response_uuids: form_response_uuids
              }
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
  end

  # ── workstation-scoped (cleaning or maintenance of the cell itself) ─

  defp handle_workstation_scoped(conn, %Workstation{} = ws, kind, ctx) do
    company_id = ws.company_id
    next_due = compute_workstation_next_due(ws, kind, ctx.ended_at)

    Repo.transaction(fn ->
      updates = workstation_cadence_updates(kind, ctx.ended_at, next_due)

      {1, _} =
        from(w in Workstation, where: w.id == ^ws.id)
        |> Repo.update_all(set: updates)

      event_attrs =
        %{
          company_id: company_id,
          workstation_id: ws.id,
          kind: audit_event_kind(kind),
          actor_kind: "system",
          started_at: DateTime.truncate(ctx.started_at, :second),
          ended_at: DateTime.truncate(ctx.ended_at, :second),
          duration_seconds: ctx.duration_seconds,
          worker_external_id: to_string_or_nil(ctx.worker_uuid),
          worker_name: to_string_or_nil(ctx.worker_name),
          vp_session_id: ctx.session_id,
          vp_shift_id: ctx.shift_id,
          form_response_uuid: first_form_response_uuid(ctx.form_response_uuids),
          reason: build_reason(kind, ws.name, ctx.worker_name),
          metadata: %{
            "workstation_uuid" => ws.uuid,
            "workstation_name" => ws.name,
            "vp_session_id" => ctx.session_id,
            "vp_shift_id" => ctx.shift_id,
            "worker_id" => ctx.worker_id,
            "worker_uuid" => ctx.worker_uuid,
            "form_response_uuids" => ctx.form_response_uuids || []
          }
        }

      case %WorkstationEvent{}
           |> WorkstationEvent.changeset(event_attrs)
           |> Repo.insert() do
        {:ok, _row} ->
          :ok

        {:error, changeset} ->
          Repo.rollback({:event_write_failed, inspect(changeset.errors)})
      end
    end)
    |> case do
      {:ok, _} ->
        Broadcasts.entity_changed(
          "workstation",
          ws.uuid,
          company_id,
          "#{kind}_completed"
        )

        # Reload with fresh cadence + republish so vp mirror updates
        # its due-soon chips. Silent-degrade like the rest of the
        # publisher.
        fresh = Repo.reload(ws)
        Publisher.publish_workstation(fresh)

        conn
        |> put_status(:ok)
        |> json(%{
          scope: "workstation",
          kind: kind,
          workstation_uuid: ws.uuid,
          last_cleaning_at: fresh.last_cleaning_at,
          next_cleaning_due_at: fresh.next_cleaning_due_at,
          last_maintenance_at: fresh.last_maintenance_at,
          next_maintenance_due_at: fresh.next_maintenance_due_at
        })

      {:error, reason} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "session_complete_failed",
            "Couldn't record the session-complete audit event.",
            %{"reason" => inspect(reason)}
          )
        )
    end
  end

  # ── equipment-scoped (cleaning or maintenance of a specific machine) ─

  defp handle_equipment_scoped(conn, %Workstation{} = ws, equipment_uuid, kind, ctx) do
    case Repo.one(
           from e in Equipment,
             where:
               e.company_id == ^ws.company_id and
                 e.uuid == ^equipment_uuid and
                 e.workstation_id == ^ws.id
         ) do
      nil ->
        conn
        |> put_status(:not_found)
        |> json(
          Errors.payload(
            "equipment_not_on_workstation",
            "That equipment isn't attached to this workstation. Refresh the picker and retry."
          )
        )

      %Equipment{} = eq ->
        next_due = compute_equipment_next_due(eq, kind, ctx.ended_at)

        Repo.transaction(fn ->
          updates = equipment_cadence_updates(kind, ctx.ended_at, next_due)

          {1, _} =
            from(e in Equipment, where: e.id == ^eq.id)
            |> Repo.update_all(set: updates)

          event_attrs = %{
            company_id: ws.company_id,
            equipment_id: eq.id,
            kind: audit_event_kind(kind),
            actor_kind: "system",
            occurred_at: DateTime.truncate(ctx.ended_at, :second),
            reason: build_reason(kind, eq_display_name(eq), ctx.worker_name),
            metadata: %{
              "workstation_uuid" => ws.uuid,
              "workstation_name" => ws.name,
              "equipment_uuid" => eq.uuid,
              "vp_session_id" => ctx.session_id,
              "vp_shift_id" => ctx.shift_id,
              "started_at" => encode_dt(ctx.started_at),
              "ended_at" => encode_dt(ctx.ended_at),
              "duration_seconds" => ctx.duration_seconds,
              "worker_id" => ctx.worker_id,
              "worker_name" => ctx.worker_name,
              "worker_uuid" => ctx.worker_uuid,
              "form_response_uuids" => ctx.form_response_uuids || []
            }
          }

          case %EquipmentEvent{}
               |> EquipmentEvent.changeset(event_attrs)
               |> Repo.insert() do
            {:ok, _row} ->
              :ok

            {:error, changeset} ->
              Repo.rollback({:event_write_failed, inspect(changeset.errors)})
          end
        end)
        |> case do
          {:ok, _} ->
            Broadcasts.entity_changed(
              "equipment",
              eq.uuid,
              ws.company_id,
              "#{kind}_completed"
            )

            fresh_eq = Repo.reload(eq)

            conn
            |> put_status(:ok)
            |> json(%{
              scope: "equipment",
              kind: kind,
              workstation_uuid: ws.uuid,
              equipment_uuid: fresh_eq.uuid,
              last_cleaning_at: fresh_eq.last_cleaning_at,
              next_cleaning_due_at: fresh_eq.next_cleaning_due_at,
              last_maintenance_at: fresh_eq.last_maintenance_at,
              next_maintenance_at: fresh_eq.next_maintenance_at
            })

          {:error, reason} ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(
              Errors.payload(
                "session_complete_failed",
                "Couldn't record the session-complete audit event.",
                %{"reason" => inspect(reason)}
              )
            )
        end
    end
  end

  # ── cadence math ─────────────────────────────────────────────────

  # Workstation next-due uses periodicity enum + interval — same math
  # as maintenance_tasks.compute_next_due.
  defp compute_workstation_next_due(%Workstation{} = ws, "cleaning", %DateTime{} = at) do
    compute_from_periodicity(ws.cleaning_periodicity, ws.cleaning_periodicity_interval, at)
  end

  defp compute_workstation_next_due(%Workstation{} = ws, "maintenance", %DateTime{} = at) do
    compute_from_periodicity(
      ws.maintenance_periodicity,
      ws.maintenance_periodicity_interval,
      at
    )
  end

  # Equipment cleaning uses periodicity (new fields). Equipment
  # maintenance uses months (existing field). Return `%Date{}` for
  # ``next_cleaning_due_at`` and `%DateTime{}` for
  # ``next_maintenance_at`` (matches existing schema types).
  defp compute_equipment_next_due(%Equipment{} = eq, "cleaning", %DateTime{} = at) do
    compute_from_periodicity(eq.cleaning_periodicity, eq.cleaning_periodicity_interval, at)
  end

  defp compute_equipment_next_due(%Equipment{} = eq, "maintenance", %DateTime{} = at) do
    case eq.maintenance_frequency_months do
      months when is_integer(months) and months > 0 ->
        add_months_dt(at, months)

      _ ->
        nil
    end
  end

  defp compute_from_periodicity(nil, _interval, _at), do: nil
  defp compute_from_periodicity(_periodicity, nil, _at), do: nil

  defp compute_from_periodicity(periodicity, interval, %DateTime{} = at)
       when is_binary(periodicity) and is_integer(interval) and interval > 0 do
    MaintenanceTasks.compute_next_due(DateTime.to_date(at), periodicity, interval)
  end

  # Add N months to a UTC datetime, preserving hour/min/sec.
  defp add_months_dt(%DateTime{} = at, months) when is_integer(months) do
    d = DateTime.to_date(at)
    target = Date.add(d, months * 30)

    case DateTime.new(target, DateTime.to_time(at), "Etc/UTC") do
      {:ok, dt} -> DateTime.truncate(dt, :second)
      _ -> nil
    end
  end

  # ── cadence-update field maps ────────────────────────────────────

  defp workstation_cadence_updates("cleaning", ended_at, next_due) do
    [
      last_cleaning_at: DateTime.truncate(ended_at, :second),
      next_cleaning_due_at: next_due,
      updated_at: DateTime.utc_now() |> DateTime.truncate(:second)
    ]
  end

  defp workstation_cadence_updates("maintenance", ended_at, next_due) do
    [
      last_maintenance_at: DateTime.truncate(ended_at, :second),
      next_maintenance_due_at: next_due,
      updated_at: DateTime.utc_now() |> DateTime.truncate(:second)
    ]
  end

  defp equipment_cadence_updates("cleaning", ended_at, next_due) do
    [
      last_cleaning_at: DateTime.truncate(ended_at, :second),
      next_cleaning_due_at: next_due,
      updated_at: DateTime.utc_now() |> DateTime.truncate(:second)
    ]
  end

  defp equipment_cadence_updates("maintenance", ended_at, next_due) do
    [
      last_maintenance_at: DateTime.truncate(ended_at, :second),
      next_maintenance_at: next_due,
      updated_at: DateTime.utc_now() |> DateTime.truncate(:second)
    ]
  end

  # ── shared plumbing ──────────────────────────────────────────────

  defp audit_event_kind("cleaning"), do: "cleaning_completed"
  defp audit_event_kind("maintenance"), do: "maintenance_completed"

  defp build_reason(kind, target_name, worker_name) do
    verb =
      case kind do
        "cleaning" -> "Cleaned"
        "maintenance" -> "Maintained"
      end

    case worker_name do
      name when is_binary(name) and name != "" ->
        "#{verb} on #{target_name} by #{name}"

      _ ->
        "#{verb} on #{target_name}"
    end
  end

  defp eq_display_name(%Equipment{} = e) do
    cond do
      e.serial_number && e.serial_number != "" -> e.serial_number
      e.model && e.model != "" -> "#{e.manufacturer} #{e.model}" |> String.trim()
      e.manufacturer && e.manufacturer != "" -> e.manufacturer
      true -> "Equipment ##{e.id}"
    end
  end

  defp first_form_response_uuid(list) when is_list(list) do
    Enum.find(list, fn s -> is_binary(s) and byte_size(s) > 0 end)
  end

  defp first_form_response_uuid(_), do: nil

  defp to_string_or_nil(nil), do: nil
  defp to_string_or_nil(v) when is_binary(v), do: v
  defp to_string_or_nil(v), do: to_string(v)

  defp encode_dt(nil), do: nil
  defp encode_dt(%DateTime{} = dt), do: DateTime.to_iso8601(dt)

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
