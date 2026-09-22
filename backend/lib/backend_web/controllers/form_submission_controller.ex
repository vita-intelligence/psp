defmodule BackendWeb.FormSubmissionController do
  @moduledoc """
  Read-side for the FormSubmission audit trail. Powers the
  ``/production/sessions`` explorer + its four entry-point drilldowns
  (form template, workstation, equipment, worker).

  Filters travel as querystring — see ``Backend.Forms.Submissions``
  for the accepted keys.

  Requires ``production.workstation_view`` — same read gate the
  workstation audit-log uses; audit rows and submissions live at the
  same trust boundary.
  """

  use BackendWeb, :controller

  alias Backend.Forms.{Submission, Submissions}
  alias BackendWeb.Errors
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "production.workstation_view"
       when action in [:index, :show, :lookup]

  action_fallback BackendWeb.FallbackController

  def index(conn, params) do
    company_id = conn.assigns.current_user.company_id
    filters = parse_filters(params)
    result = Submissions.list(company_id, filters)

    json(conn, %{
      items: Enum.map(result.items, &row_payload/1),
      next_cursor: result.next_cursor,
      limit: result.limit
    })
  end

  def show(conn, %{"uuid" => uuid}) do
    company_id = conn.assigns.current_user.company_id

    case Submissions.get_by_uuid(company_id, uuid) do
      %Submission{} = submission ->
        json(conn, %{submission: detail_payload(submission)})

      nil ->
        conn
        |> put_status(:not_found)
        |> json(
          Errors.payload(
            "submission_not_found",
            "No form submission with that uuid in your workspace."
          )
        )
    end
  end

  @allowed_lookup_types ~w(workstation equipment form submitter)

  def lookup(conn, %{"type" => type} = params) when type in @allowed_lookup_types do
    company_id = conn.assigns.current_user.company_id

    items =
      Submissions.lookup(company_id, String.to_existing_atom(type), %{
        q: params["q"],
        uuid: params["uuid"],
        limit: params["limit"]
      })

    json(conn, %{items: items})
  end

  def lookup(conn, _params) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(
      Errors.payload(
        "invalid_lookup_type",
        "type must be one of #{Enum.join(@allowed_lookup_types, ", ")}."
      )
    )
  end

  # ── Params ───────────────────────────────────────────────────────

  defp parse_filters(params) do
    %{
      workstation_uuid: params["workstation_uuid"],
      equipment_uuid: params["equipment_uuid"],
      form_template_uuid: params["form_template_uuid"],
      workstation_session_uuid: params["workstation_session_uuid"],
      submitted_by_id: params["submitted_by_id"],
      submitted_by_uuid: params["submitted_by_uuid"],
      trigger: params["trigger"],
      activity_kind: params["activity_kind"],
      from: params["from"],
      to: params["to"],
      search: params["search"],
      cursor: params["cursor"],
      limit: params["limit"]
    }
  end

  # ── Payload shapes ───────────────────────────────────────────────

  # Row shape — flat, no nested schema. Optimised for a wide list
  # view where the operator scans many rows before opening one.
  defp row_payload(%Submission{} = s) do
    %{
      uuid: s.uuid,
      form_name: s.form_name,
      form_trigger: s.form_trigger,
      form_template_uuid: s.form_template_uuid,
      workstation: workstation_ref(s.workstation),
      workstation_uuid: s.workstation_uuid,
      equipment: equipment_ref(s.equipment),
      equipment_uuid: s.equipment_uuid,
      activity_kind: s.activity_kind,
      submitted_by: submitter_ref(s),
      submitted_at: s.submitted_at,
      answer_count: map_size(s.answers || %{}),
      session: session_ref(s.workstation_session)
    }
  end

  # Detail shape — carries the frozen schema + full answers so the
  # detail page renders exactly what the operator saw, even if the
  # template has since been edited or archived.
  defp detail_payload(%Submission{} = s) do
    %{
      uuid: s.uuid,
      form_name: s.form_name,
      form_trigger: s.form_trigger,
      form_template_uuid: s.form_template_uuid,
      schema_snapshot: s.schema_snapshot,
      schema_version: s.schema_version,
      answers: s.answers,
      workstation: workstation_ref(s.workstation),
      workstation_uuid: s.workstation_uuid,
      equipment: equipment_ref(s.equipment),
      equipment_uuid: s.equipment_uuid,
      activity_kind: s.activity_kind,
      submitted_by: submitter_ref(s),
      submitted_at: s.submitted_at,
      session: session_ref(s.workstation_session),
      inserted_at: s.inserted_at
    }
  end

  defp workstation_ref(nil), do: nil

  defp workstation_ref(ws),
    do: %{id: ws.id, uuid: ws.uuid, name: ws.name}

  defp equipment_ref(nil), do: nil

  defp equipment_ref(eq) do
    %{
      id: eq.id,
      uuid: eq.uuid,
      serial_number: eq.serial_number
    }
  end

  # Snapshot fields are always populated (denormalised at submit
  # time) so we never depend on the User FK being resolvable —
  # workers can leave the company and their audit trail still
  # renders their name.
  defp submitter_ref(%Submission{submitted_by_id: id, submitted_by_uuid: uuid, submitted_by_name: name}),
    do: %{id: id, name: name, worker_uuid: uuid}

  defp session_ref(nil), do: nil

  defp session_ref(session) do
    %{
      id: session.id,
      uuid: session.uuid,
      activity_kind: session.activity_kind,
      started_at: session.started_at,
      finished_at: session.finished_at,
      manufacturing_order_step_id: session.manufacturing_order_step_id
    }
  end
end
