defmodule BackendWeb.FormTemplateController do
  @moduledoc """
  Form template CRUD — the library of checklists PSP publishes to the
  vita-performance kiosk (start-of-shift / end-of-shift / cleaning).

    * ``GET    /api/form-templates``
    * ``GET    /api/form-templates/:id``
    * ``POST   /api/form-templates``
    * ``PATCH  /api/form-templates/:id``
    * ``DELETE /api/form-templates/:id`` — soft (flips is_active)
    * ``POST   /api/form-templates/:id/reactivate``

  Every write bumps ``version`` (see ``Backend.Forms.Templates``); the
  publisher uses it as the idempotency key when upserting into the
  vita-performance mirror.
  """

  use BackendWeb, :controller

  alias Backend.Forms.FormTemplate
  alias Backend.Forms.Templates
  alias BackendWeb.Errors
  alias BackendWeb.FallbackController
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "forms.view" when action in [:index, :show]

  plug RequirePermission,
       "forms.act" when action in [:create, :update, :delete, :reactivate]

  action_fallback FallbackController

  def index(conn, params) do
    actor = conn.assigns.current_user

    include_inactive? =
      case params["include_inactive"] do
        v when v in ["1", "true", true] -> true
        _ -> false
      end

    rows =
      cond do
        is_binary(params["trigger"]) and params["trigger"] != "" ->
          Templates.list_active_by_trigger(actor.company_id, params["trigger"])

        include_inactive? ->
          Templates.list_for_company(actor.company_id)

        true ->
          Templates.list_active_for_company(actor.company_id)
      end

    json(conn, %{
      items: Enum.map(rows, &Payloads.form_template/1),
      total: length(rows)
    })
  end

  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Templates.get_for_company(actor.company_id, uuid) do
      nil -> not_found(conn)
      %FormTemplate{} = t -> json(conn, %{form_template: Payloads.form_template(t)})
    end
  end

  def create(conn, params) do
    actor = conn.assigns.current_user

    case Templates.create(actor.company_id, params, actor) do
      {:ok, t} ->
        conn
        |> put_status(:created)
        |> json(%{form_template: Payloads.form_template(t)})

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %FormTemplate{} = t <- Templates.get_for_company(actor.company_id, uuid),
         {:ok, updated} <- Templates.update(t, Map.drop(params, ["id"]), actor) do
      json(conn, %{form_template: Payloads.form_template(updated)})
    else
      nil -> not_found(conn)
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  def delete(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    with %FormTemplate{} = t <- Templates.get_for_company(actor.company_id, uuid),
         {:ok, updated} <- Templates.deactivate(t, actor) do
      json(conn, %{form_template: Payloads.form_template(updated)})
    else
      nil -> not_found(conn)
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  def reactivate(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    with %FormTemplate{} = t <- Templates.get_for_company(actor.company_id, uuid),
         {:ok, updated} <- Templates.reactivate(t, actor) do
      json(conn, %{form_template: Payloads.form_template(updated)})
    else
      nil -> not_found(conn)
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  def workstations(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Templates.get_for_company(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %FormTemplate{} = t ->
        rows =
          t
          |> Templates.workstations_using()
          |> Enum.map(fn {ws, slot} ->
            summary = Payloads.workstation_summary(ws)
            Map.put(summary, :slot, slot)
          end)

        json(conn, %{items: rows, total: length(rows)})
    end
  end

  defp not_found(conn) do
    conn
    |> put_status(:not_found)
    |> json(Errors.payload("not_found", "Form template not found."))
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
