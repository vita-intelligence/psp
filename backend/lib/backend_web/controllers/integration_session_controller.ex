defmodule BackendWeb.IntegrationSessionController do
  @moduledoc """
  Writeback endpoints for kiosk-generated WorkstationSessions. Two
  entry points, one schema underneath:

    * `POST /api/integration/manufacturing-orders/:uuid/steps/:step_uuid/sessions`
      — MO-attached. Also stamps `actual_start` on the step if
      not already set.
    * `POST /api/integration/workstations/:uuid/sessions`
      — off-MO (cleaning / maintenance / other). Requires
      `activity_kind ∈ ["cleaning", "maintenance", "other"]`.

  Both paths refuse to write to a Workstation whose
  `psp_source_of_truth` flag is off — that station hasn't been cut
  over to the integration yet, and accepting the write would create
  ghost data.

  Idempotency: repeated writes with the same `external_id` return
  the existing row rather than duplicating (protects against the
  outbox retrying a slow response).
  """

  use BackendWeb, :controller

  import Ecto.Query
  import BackendWeb.IntegrationScopePlug

  alias Backend.Production.{ManufacturingOrder, ManufacturingOrderStep, Workstation, WorkstationSession}
  alias Backend.Repo
  alias BackendWeb.Errors

  plug :require_integration_scope, "mo:write:session" when action == :create_mo_session

  plug :require_integration_scope, "mo:write:session"
       when action == :create_workstation_session

  action_fallback BackendWeb.FallbackController

  # ---- MO-attached ----

  def create_mo_session(conn, %{"uuid" => mo_uuid, "step_uuid" => step_uuid} = params) do
    company_id = conn.assigns.current_company_id
    workstation_uuid = params["workstation_uuid"]

    if is_nil(workstation_uuid) or workstation_uuid == "" do
      conn
      |> put_status(:unprocessable_entity)
      |> json(
        Errors.payload(
          "validation_failed",
          "workstation_uuid is required — kiosk sends the physical station it ran on."
        )
      )
    else
      # MO steps route to workstation_groups, not to specific
      # stations. The kiosk knows the station it's running on and
      # sends `workstation_uuid` in the body — we look it up here
      # rather than trying to derive it from the step. Cross-company
      # tampering is blocked by the company_id filter on both.
      with %ManufacturingOrder{} = mo <-
             Repo.one(
               from m in ManufacturingOrder,
                 where: m.company_id == ^company_id and m.uuid == ^mo_uuid
             ),
           %ManufacturingOrderStep{} = step <-
             Repo.one(
               from s in ManufacturingOrderStep,
                 where: s.uuid == ^step_uuid and s.manufacturing_order_id == ^mo.id
             ),
           %Workstation{} = ws <-
             Repo.one(
               from w in Workstation,
                 where: w.company_id == ^company_id and w.uuid == ^workstation_uuid
             ),
           :ok <- guard_source_of_truth(ws),
           {:ok, session} <- do_upsert_session(company_id, ws.id, step.id, "mo", params),
           :ok <- maybe_stamp_actuals(step, session) do
        broadcast_session(session, mo)

        conn
        |> put_status(:created)
        |> json(%{workstation_session: session_payload(session)})
      else
        nil -> {:error, :not_found}
        {:error, :not_source_of_truth} -> refuse_not_sot(conn)
        {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      end
    end
  end

  # ---- Off-MO ----

  def create_workstation_session(conn, %{"uuid" => ws_uuid} = params) do
    company_id = conn.assigns.current_company_id

    with %Workstation{} = ws <-
           Repo.one(
             from w in Workstation,
               where: w.company_id == ^company_id and w.uuid == ^ws_uuid
           ),
         :ok <- guard_source_of_truth(ws),
         :ok <- guard_off_mo_activity(params["activity_kind"]),
         {:ok, session} <-
           do_upsert_session(company_id, ws.id, nil, params["activity_kind"], params) do
      broadcast_session(session, nil)

      conn
      |> put_status(:created)
      |> json(%{workstation_session: session_payload(session)})
    else
      nil ->
        {:error, :not_found}

      {:error, :not_source_of_truth} ->
        refuse_not_sot(conn)

      {:error, :bad_activity_kind} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "validation_failed",
            "activity_kind must be one of cleaning / maintenance / other on this endpoint."
          )
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  # ---- Internals ----

  defp guard_source_of_truth(%Workstation{psp_source_of_truth: true}), do: :ok
  defp guard_source_of_truth(_), do: {:error, :not_source_of_truth}

  defp guard_off_mo_activity(kind) when kind in ["cleaning", "maintenance", "other"], do: :ok
  defp guard_off_mo_activity(_), do: {:error, :bad_activity_kind}

  defp do_upsert_session(company_id, workstation_id, mo_step_id, activity_kind, params) do
    external_id = params["external_id"]

    existing =
      case external_id do
        id when is_binary(id) and id != "" ->
          Repo.one(
            from s in WorkstationSession,
              where: s.company_id == ^company_id and s.external_id == ^id
          )

        _ ->
          nil
      end

    attrs = %{
      company_id: company_id,
      workstation_id: workstation_id,
      manufacturing_order_step_id: mo_step_id,
      external_id: external_id,
      activity_kind: activity_kind,
      activity_label: params["activity_label"],
      employee_uuids: params["employee_uuids"] || [],
      started_at: parse_dt(params["started_at"]),
      finished_at: parse_dt(params["finished_at"]),
      quantity_produced: params["quantity_produced"],
      quantity_rejected: params["quantity_rejected"],
      performance_percentage: params["performance_percentage"],
      notes: params["notes"],
      form_responses: params["form_responses"] || %{},
      status: params["status"] || "completed"
    }

    case existing do
      %WorkstationSession{status: "completed"} = row ->
        # Already sealed — writeback re-runs (retries after a network
        # hiccup) are silent no-ops. Prevents a kiosk resend from
        # rolling back a completed session to active.
        {:ok, row}

      %WorkstationSession{status: "verified"} = row ->
        {:ok, row}

      %WorkstationSession{} = row ->
        # Live update: kiosk started a session, now sends the "stop"
        # payload. Fold the new fields onto the existing row so the
        # timeline flips from running → completed with proper qty,
        # performance, and finish time — without inserting a
        # duplicate row.
        row
        |> WorkstationSession.create_changeset(attrs)
        |> Repo.update()

      nil ->
        %WorkstationSession{}
        |> WorkstationSession.create_changeset(attrs)
        |> Repo.insert()
    end
  end

  defp maybe_stamp_actuals(%ManufacturingOrderStep{} = step, %WorkstationSession{} = session) do
    finish_field = actual_finish_field(step)
    step_finish = get_step_actual_finish(step)

    changes =
      %{}
      |> maybe_put(:actual_start, step.actual_start, session.started_at)
      |> maybe_put(finish_field, step_finish, session.finished_at)

    if changes == %{} do
      :ok
    else
      step
      |> Ecto.Changeset.change(changes)
      |> Repo.update()
      |> case do
        {:ok, _} -> :ok
        {:error, cs} -> {:error, cs}
      end
    end
  end

  # PSP splits actual_finish across `actual_end` / `actual_finish`
  # across versions — probe both.
  defp actual_finish_field(step) do
    cond do
      Map.has_key?(step, :actual_finish) -> :actual_finish
      Map.has_key?(step, :actual_end) -> :actual_end
      true -> nil
    end
  end

  defp get_step_actual_finish(step) do
    Map.get(step, :actual_finish) || Map.get(step, :actual_end)
  end

  defp maybe_put(map, nil, _existing, _new), do: map
  defp maybe_put(map, _key, existing, _new) when not is_nil(existing), do: map
  defp maybe_put(map, key, nil, new) when not is_nil(new), do: Map.put(map, key, new)
  defp maybe_put(map, _key, _existing, _new), do: map

  defp parse_dt(nil), do: nil
  defp parse_dt(%DateTime{} = dt), do: DateTime.truncate(dt, :second)

  defp parse_dt(s) when is_binary(s) do
    case DateTime.from_iso8601(s) do
      {:ok, dt, _} -> DateTime.truncate(dt, :second)
      _ -> nil
    end
  end

  defp session_payload(%WorkstationSession{} = s) do
    %{
      uuid: s.uuid,
      external_id: s.external_id,
      activity_kind: s.activity_kind,
      activity_label: s.activity_label,
      manufacturing_order_step_id: s.manufacturing_order_step_id,
      employee_uuids: s.employee_uuids,
      started_at: s.started_at,
      finished_at: s.finished_at,
      quantity_produced: s.quantity_produced && to_string(s.quantity_produced),
      quantity_rejected: s.quantity_rejected && to_string(s.quantity_rejected),
      performance_percentage: s.performance_percentage,
      status: s.status,
      inserted_at: s.inserted_at
    }
  end

  # Fan a session create out to every subscriber that cares. Fire-
  # and-forget: broadcast failures never leak back to the kiosk
  # writeback caller. We push three topics so a wizard viewing the
  # CO, a user on the MO detail page, and a live-list page all
  # refresh in <250ms.
  defp broadcast_session(%WorkstationSession{} = session, mo) do
    company_id = session.company_id
    Backend.Broadcasts.entity_changed("workstation_session", session.uuid, company_id, "created")

    if mo do
      Backend.Broadcasts.entity_changed(
        "workstation_session_mo",
        mo.uuid,
        company_id,
        "created"
      )

      # Also broadcast to the parent CO if the MO is tied to one so
      # the wizard timeline refreshes without polling.
      case Repo.preload(mo, :customer_order_line) do
        %ManufacturingOrder{customer_order_line: %{customer_order_id: co_id}}
        when not is_nil(co_id) ->
          case Repo.get(Backend.CustomerOrders.CustomerOrder, co_id) do
            %{uuid: co_uuid} ->
              Backend.Broadcasts.entity_changed(
                "workstation_session_co",
                co_uuid,
                company_id,
                "created"
              )

            _ ->
              :ok
          end

        _ ->
          :ok
      end
    end

    :ok
  end

  defp refuse_not_sot(conn) do
    conn
    |> put_status(:conflict)
    |> json(
      Errors.payload(
        "workstation_not_source_of_truth",
        "This workstation hasn't been cut over to the PSP integration yet (psp_source_of_truth is false)."
      )
    )
  end

  defp changeset_error(conn, cs) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(
      Errors.payload(
        "validation_failed",
        "Please correct the highlighted fields.",
        Errors.changeset_fields(cs)
      )
    )
  end
end
