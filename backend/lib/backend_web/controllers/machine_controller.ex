defmodule BackendWeb.MachineController do
  @moduledoc """
  Machines CRUD + Recalibrate action. Permission-gated by the
  `production.machine_*` family.

  Recalibrate is a bespoke POST because it's a compliance action, not
  a header edit — it captures the calibration event with the actor +
  timestamp (via the standard audit trail) and auto-computes the next
  due date from the machine's `calibration_frequency_months`.
  """

  use BackendWeb, :controller

  alias Backend.Production
  alias Backend.Production.Machine
  alias BackendWeb.Errors
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  action_fallback BackendWeb.FallbackController

  plug RequirePermission, "production.machine_view" when action in [:index, :show]
  plug RequirePermission, "production.machine_create" when action in [:create]
  plug RequirePermission, "production.machine_edit" when action in [:update]
  plug RequirePermission, "production.machine_delete" when action in [:delete]
  plug RequirePermission, "production.machine_recalibrate" when action in [:recalibrate]

  # GET /api/production/machines
  def index(conn, params) do
    actor = conn.assigns.current_user

    opts =
      [
        cursor: params["cursor"],
        limit: params["limit"],
        sort: parse_sort(params["sort"]),
        search: params["search"],
        column_filter: params["column_filter"],
        workstation_id: params["workstation_id"],
        is_active: params["is_active"]
      ]
      |> Enum.reject(fn {_k, v} -> is_nil(v) end)

    {items, next_cursor} = Production.list_machines_page(actor.company_id, opts)

    json(conn, %{
      items: Enum.map(items, &Payloads.machine_summary/1),
      next_cursor: next_cursor
    })
  end

  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get_machine(actor.company_id, uuid) do
      nil -> not_found(conn)
      %Machine{} = m -> json(conn, %{machine: Payloads.machine(m)})
    end
  end

  def create(conn, params) do
    actor = conn.assigns.current_user

    case Production.create_machine(actor, params) do
      {:ok, m} ->
        conn
        |> put_status(:created)
        |> json(%{machine: Payloads.machine(m)})

      {:error, :workstation_required} ->
        unprocessable(conn, "workstation_required", "Pick a workstation to attach this machine to.")

      {:error, :workstation_not_found} ->
        unprocessable(conn, "workstation_not_found", "Selected workstation doesn't exist.")

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    case Production.get_machine(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %Machine{} = m ->
        case Production.update_machine(actor, m, params) do
          {:ok, updated} ->
            json(conn, %{machine: Payloads.machine(updated)})

          {:error, :workstation_not_found} ->
            unprocessable(conn, "workstation_not_found", "Selected workstation doesn't exist.")

          {:error, %Ecto.Changeset{} = cs} ->
            changeset_error(conn, cs)
        end
    end
  end

  def delete(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get_machine(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %Machine{} = m ->
        case Production.delete_machine(actor, m) do
          {:ok, _} -> send_resp(conn, :no_content, "")
          {:error, cs} -> changeset_error(conn, cs)
        end
    end
  end

  # POST /api/production/machines/:id/recalibrate
  #
  # Payload (all optional):
  #   * calibrated_at — ISO date; defaults to today
  #   * frequency_months — override the stored cadence for this event
  def recalibrate(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    case Production.get_machine(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %Machine{} = m ->
        case Production.recalibrate_machine(actor, m, params) do
          {:ok, updated} ->
            json(conn, %{machine: Payloads.machine(updated)})

          {:error, %Ecto.Changeset{} = cs} ->
            changeset_error(conn, cs)
        end
    end
  end

  # ----- helpers ---------------------------------------------------

  defp parse_sort(nil), do: nil
  defp parse_sort(""), do: nil

  defp parse_sort(s) when is_binary(s) do
    case String.split(s, ":", parts: 2) do
      [field, "asc"] -> {String.to_existing_atom(field), :asc}
      [field, "desc"] -> {String.to_existing_atom(field), :desc}
      _ -> nil
    end
  rescue
    ArgumentError -> nil
  end

  defp not_found(conn) do
    conn
    |> put_status(:not_found)
    |> json(Errors.payload("not_found", "Machine not found.", %{}))
  end

  defp unprocessable(conn, code, detail) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(Errors.payload(code, detail, %{}))
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
