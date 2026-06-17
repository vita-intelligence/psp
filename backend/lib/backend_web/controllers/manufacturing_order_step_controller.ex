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
