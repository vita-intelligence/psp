defmodule BackendWeb.MoQcNotesController do
  @moduledoc """
  Chronological QC-note timeline for the MO detail page + the Output
  QC review page.

    * `GET /api/manufacturing-orders/:id/qc-notes`

  Reads from `audit_events` where `entity_type='manufacturing_order'`
  and `event='note_added'` (populated by
  `BackendWeb.IntegrationQcNoteController` when a vita-perf QC
  operator saves a note on the Live QC kiosk page).

  Returned in ascending order — oldest note first — so the reader
  can follow the production timeline in the same direction it
  happened. Gated by `production.mo_view` (same rule as the sessions
  timeline: if you can see the MO, you can see its QC notes).
  """

  use BackendWeb, :controller

  import Ecto.Query

  alias Backend.Audit.AuditEvent
  alias Backend.Production.ManufacturingOrder
  alias Backend.Repo
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "production.mo_view" when action == :index

  action_fallback BackendWeb.FallbackController

  def index(conn, %{"id" => id_or_uuid}) do
    actor = conn.assigns.current_user

    with {:ok, mo} <- resolve_mo(actor.company_id, id_or_uuid) do
      notes =
        from(e in AuditEvent,
          where:
            e.company_id == ^actor.company_id and
              e.entity_type == "manufacturing_order" and
              e.entity_id == ^mo.id and
              e.event == "note_added",
          order_by: [asc: e.at]
        )
        |> Repo.all()

      json(conn, %{
        mo_uuid: mo.uuid,
        count: length(notes),
        notes: Enum.map(notes, &shape_note/1)
      })
    else
      _ -> {:error, :not_found}
    end
  end

  # Flatten an AuditEvent row into the shape the FE card renders.
  # Reads the note text + metadata we stashed under `changes` when
  # the vita-perf callback fired (see
  # `Backend.Audit.record_note/5`).
  defp shape_note(%AuditEvent{} = e) do
    changes = e.changes || %{}
    actor = e.actor_snapshot || %{}

    %{
      id: e.id,
      at: e.at,
      note: Map.get(changes, "note") || "",
      author_name: Map.get(actor, "name") || Map.get(actor, "kind") || "QC",
      author_kind: Map.get(actor, "kind") || "user",
      worker_uuid: Map.get(changes, "worker_uuid"),
      workstation_uuid: Map.get(changes, "workstation_uuid"),
      mo_step_uuid: Map.get(changes, "mo_step_uuid"),
      captured_at: Map.get(changes, "captured_at")
    }
  end

  defp resolve_mo(company_id, id_or_uuid) when is_binary(id_or_uuid) do
    query =
      case Integer.parse(id_or_uuid) do
        {mo_id, ""} ->
          from(m in ManufacturingOrder,
            where: m.company_id == ^company_id and m.id == ^mo_id
          )

        _ ->
          from(m in ManufacturingOrder,
            where: m.company_id == ^company_id and m.uuid == ^id_or_uuid
          )
      end

    case Repo.one(query) do
      %ManufacturingOrder{} = mo -> {:ok, mo}
      _ -> :error
    end
  end

  defp resolve_mo(_, _), do: :error
end
