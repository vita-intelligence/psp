defmodule BackendWeb.ManufacturingOrderStepController do
  @moduledoc """
  Per-MO operation step — the editable instance of a routing template
  step. The FE shows a pencil per row; clicking it opens the modify
  page that hits these endpoints.

  Field-level permission split:

    * Header + planned + workers     → `production.mo_edit`
    * Actuals (start/finish/quantity) + labor cost → `production.mo_execute`

  We split the rule so a planner can prep the run without the
  authority to mark it complete, and an operator on the floor can log
  actuals without being able to rewrite the plan.
  """

  use BackendWeb, :controller

  alias Backend.Production
  alias Backend.Production.ManufacturingOrder
  alias Backend.Production.ManufacturingOrderStep
  alias Backend.RBAC
  alias BackendWeb.Errors
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  action_fallback BackendWeb.FallbackController

  plug RequirePermission, "production.mo_view" when action in [:show]

  @execute_only_fields ~w(
    actual_start actual_finish quantity labor_cost
  )

  def show(conn, %{"mo_id" => mo_uuid, "id" => uuid}) do
    actor = conn.assigns.current_user

    with %ManufacturingOrder{id: mo_id} <-
           Production.get_manufacturing_order(actor.company_id, mo_uuid),
         %ManufacturingOrderStep{manufacturing_order_id: ^mo_id} = step <-
           Production.get_mo_step(actor.company_id, uuid) do
      json(conn, %{step: Payloads.mo_step(step)})
    else
      _ -> not_found(conn)
    end
  end

  def update(conn, %{"mo_id" => mo_uuid, "id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %ManufacturingOrder{id: mo_id} <-
           Production.get_manufacturing_order(actor.company_id, mo_uuid),
         %ManufacturingOrderStep{manufacturing_order_id: ^mo_id} = step <-
           Production.get_mo_step(actor.company_id, uuid),
         :ok <- ensure_required_perms(actor, params) do
      case Production.update_mo_step(actor, step, params) do
        {:ok, updated} ->
          json(conn, %{step: Payloads.mo_step(updated)})

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      :missing_edit ->
        forbidden(conn, "Missing production.mo_edit permission.")

      :missing_execute ->
        forbidden(
          conn,
          "Logging actual start/finish or labor cost needs production.mo_execute."
        )

      _ ->
        not_found(conn)
    end
  end

  # POST /api/production/manufacturing-orders/:mo_id/steps/:id/move
  # Body: %{"new_start_at" => ISO datetime, "workstation_group_id" => N?}
  # Re-walks this single step through working hours starting from
  # `new_start_at`. Used by the workstation-view op drag so dropped
  # blocks always land inside a working window.
  def move(conn, %{
        "mo_id" => mo_uuid,
        "id" => uuid,
        "new_start_at" => start_raw
      } = params) when is_binary(start_raw) do
    actor = conn.assigns.current_user

    opts =
      case params["workstation_group_id"] do
        nil -> []
        wsg when is_integer(wsg) -> [workstation_group_id: wsg]
        wsg when is_binary(wsg) ->
          case Integer.parse(wsg) do
            {n, ""} -> [workstation_group_id: n]
            _ -> []
          end
        _ -> []
      end

    with %ManufacturingOrder{id: mo_id} <-
           Production.get_manufacturing_order(actor.company_id, mo_uuid),
         %ManufacturingOrderStep{manufacturing_order_id: ^mo_id} = step <-
           Production.get_mo_step(actor.company_id, uuid),
         true <- RBAC.has_permission?(actor, "production.mo_edit"),
         {:ok, dt, _offset} <- DateTime.from_iso8601(start_raw),
         {:ok, updated, meta} <-
           Production.move_mo_step(
             actor,
             step,
             DateTime.shift_zone!(dt, "Etc/UTC"),
             opts
           ) do
      json(conn, %{
        step: Payloads.mo_step(updated),
        outside_hours_seconds: meta.outside_hours_seconds
      })
    else
      false ->
        forbidden(conn, "Missing production.mo_edit permission.")

      {:error, :past_time} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "past_time",
            "Can't move the operation before the current time.",
            %{}
          )
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)

      _ ->
        not_found(conn)
    end
  end

  def move(conn, _) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(
      Errors.payload(
        "invalid_payload",
        "Pass new_start_at as an ISO datetime.",
        %{}
      )
    )
  end

  # POST /api/production/manufacturing-orders/:mo_id/steps/:id/set-segments
  # Body: %{"segments" => [%{"start_at" => iso, "finish_at" => iso}, ...]}
  # Persists the planner's literal segments (no walker). Used by the
  # click-to-edit dialog when they pin start / finish per work block
  # and insert custom pauses between them.
  def set_segments(conn, %{"mo_id" => mo_uuid, "id" => uuid, "segments" => segments})
      when is_list(segments) do
    actor = conn.assigns.current_user

    with %ManufacturingOrder{id: mo_id} <-
           Production.get_manufacturing_order(actor.company_id, mo_uuid),
         %ManufacturingOrderStep{manufacturing_order_id: ^mo_id} = step <-
           Production.get_mo_step(actor.company_id, uuid),
         true <- RBAC.has_permission?(actor, "production.mo_edit"),
         {:ok, updated} <-
           Production.set_mo_step_segments(actor, step, segments) do
      json(conn, %{step: Payloads.mo_step(updated)})
    else
      false ->
        forbidden(conn, "Missing production.mo_edit permission.")

      {:error, :invalid_segments} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "invalid_segments",
            "Every segment needs an ISO8601 start_at and finish_at.",
            %{}
          )
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)

      _ ->
        not_found(conn)
    end
  end

  def set_segments(conn, _) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(
      Errors.payload(
        "invalid_payload",
        "Pass segments as a list of {start_at, finish_at} maps.",
        %{}
      )
    )
  end

  # ----- helpers ---------------------------------------------------

  defp ensure_required_perms(actor, params) do
    touches_execute_only =
      Enum.any?(@execute_only_fields, fn key -> Map.has_key?(params, key) end)

    cond do
      not RBAC.has_permission?(actor, "production.mo_edit") ->
        :missing_edit

      touches_execute_only and
          not RBAC.has_permission?(actor, "production.mo_execute") ->
        :missing_execute

      true ->
        :ok
    end
  end

  defp not_found(conn) do
    conn
    |> put_status(:not_found)
    |> json(Errors.payload("not_found", "Operation step not found.", %{}))
  end

  defp forbidden(conn, detail) do
    conn
    |> put_status(:forbidden)
    |> json(Errors.payload("forbidden", detail, %{}))
  end

  defp changeset_error(conn, cs) do
    payload =
      Errors.payload(
        "validation_failed",
        "One or more fields failed validation.",
        Errors.changeset_fields(cs)
      )

    conn
    |> put_status(:unprocessable_entity)
    |> json(payload)
  end
end
