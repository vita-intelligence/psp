defmodule BackendWeb.IntegrationQcNoteController do
  @moduledoc """
  QC-note callback from vita-performance.

    * ``POST /api/integration/manufacturing-orders/:uuid/qc-note/``

  Fired by vita-perf when a QC operator (`workers.is_qa = true`)
  writes an inspection note against an in-progress MO on the personal
  kiosk's Live-QC page. PSP is the compliance ledger — the note lands
  in the MO's standard audit history so it renders on the Activity
  card alongside every other event.

  Body params:

    * ``note_text`` (string, required) — the free-form note the
      operator typed.
    * ``worker_name`` (string, optional) — captured for the audit-log
      "author" column when the vita-perf worker isn't mirrored on the
      PSP `users` table (kiosk operators typically aren't).
    * ``worker_uuid`` (string, optional) — vita-perf `Worker.uuid`,
      recorded on the event metadata for cross-system traceability.
    * ``workstation_uuid`` (string, optional) — the workstation the
      operator was standing at, snapshotted for context.
    * ``mo_step_uuid`` (string, optional) — the specific step within
      the MO the note applies to; empty means the whole MO.
    * ``captured_at`` (ISO8601, optional) — when the kiosk actually
      captured the note (in case the callback lags). Defaults to
      server-side now.

  Requires scope ``mo:write:qc_note``.
  """

  use BackendWeb, :controller

  import Ecto.Query
  import BackendWeb.IntegrationScopePlug

  alias Backend.Audit
  alias Backend.Production.ManufacturingOrder
  alias Backend.Repo

  plug :require_integration_scope, "mo:write:qc_note" when action == :create

  action_fallback BackendWeb.FallbackController

  def create(conn, %{"uuid" => mo_uuid} = params) do
    company_id = conn.assigns.current_company_id

    note_text = params |> Map.get("note_text", "") |> to_string() |> String.trim()

    if note_text == "" do
      conn
      |> put_status(:bad_request)
      |> json(%{
        error: "note_text_required",
        detail: "QC notes must include non-empty text."
      })
    else
      case Repo.one(
             from mo in ManufacturingOrder,
               where: mo.company_id == ^company_id and mo.uuid == ^mo_uuid
           ) do
        nil ->
          conn
          |> put_status(:not_found)
          |> json(%{
            error: "mo_not_found",
            detail: "No MO with that UUID in this tenant."
          })

        %ManufacturingOrder{} = mo ->
          # Kiosk workers aren't PSP `users` — record as a system-kind
          # actor with the worker's display name so the Activity card
          # shows "QC · Alice Smith" without needing a mirrored user.
          worker_name = params |> Map.get("worker_name") |> to_string()
          actor = %{
            kind: "kiosk_qc",
            name: if(worker_name == "", do: "QC operator", else: worker_name),
            source: "vita-performance"
          }

          metadata =
            %{}
            |> maybe_put("event_semantic", "qc_note")
            |> maybe_put("worker_uuid", params["worker_uuid"])
            |> maybe_put("workstation_uuid", params["workstation_uuid"])
            |> maybe_put("mo_step_uuid", params["mo_step_uuid"])
            |> maybe_put("captured_at", params["captured_at"])

          Audit.record_note(actor, "manufacturing_order", mo, note_text, metadata)

          conn
          |> put_status(:created)
          |> json(%{ok: true, mo_uuid: mo.uuid})
      end
    end
  end

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, _key, ""), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)
end
