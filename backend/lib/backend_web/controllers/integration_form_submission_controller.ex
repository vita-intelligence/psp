defmodule BackendWeb.IntegrationFormSubmissionController do
  @moduledoc """
  Writeback for filled DynamicForms from the vp kiosk. Idempotent
  on ``(company_id, vp_response_id)`` so an outbox retry after a
  transient PSP hiccup lands on the same row.

  Auth: reuses ``mo:write:session`` — form submissions travel with
  sessions, and giving the same token both scopes on setup keeps
  the operator config uniform (no new scope to grant when we ship
  this).
  """

  use BackendWeb, :controller

  import BackendWeb.IntegrationScopePlug

  alias Backend.Forms.{Submission, Submissions}
  alias BackendWeb.Errors

  plug :require_integration_scope, "mo:write:session"

  action_fallback BackendWeb.FallbackController

  def create(conn, params) do
    company_id = conn.assigns.current_company_id

    case Submissions.upsert_from_vp(company_id, params) do
      {:ok, %Submission{} = submission} ->
        conn
        |> put_status(:created)
        |> json(%{form_submission: payload(submission)})

      {:error, :missing_workstation_uuid} ->
        validation(conn, "workstation_uuid is required.")

      {:error, :invalid_workstation_uuid} ->
        validation(conn, "workstation_uuid is not a valid uuid.")

      {:error, :workstation_not_found} ->
        conn
        |> put_status(:not_found)
        |> json(
          Errors.payload(
            "workstation_not_found",
            "No workstation matches the workstation_uuid on this tenant."
          )
        )

      {:error, :missing_form_template_uuid} ->
        validation(conn, "form_template_uuid is required.")

      {:error, :invalid_form_template_uuid} ->
        validation(conn, "form_template_uuid is not a valid uuid.")

      {:error, :form_template_not_found} ->
        conn
        |> put_status(:not_found)
        |> json(
          Errors.payload(
            "form_template_not_found",
            "No form template matches the form_template_uuid on this tenant."
          )
        )

      {:error, {:missing, key}} ->
        validation(conn, "#{key} is required.")

      {:error, {:invalid, key}} ->
        validation(conn, "#{key} is not in a valid format.")

      {:error, %Ecto.Changeset{} = cs} ->
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

  defp validation(conn, detail) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(Errors.payload("validation_failed", detail))
  end

  defp payload(%Submission{} = s) do
    %{
      uuid: s.uuid,
      workstation_uuid: s.workstation_uuid,
      equipment_uuid: s.equipment_uuid,
      form_template_uuid: s.form_template_uuid,
      form_trigger: s.form_trigger,
      submitted_at: s.submitted_at,
      inserted_at: s.inserted_at
    }
  end
end
