defmodule BackendWeb.EquipmentController do
  @moduledoc """
  REST surface for the equipment registry. Reuses the same auth +
  RBAC pattern as StockLotController.

    * `GET  /api/equipment`               — list units for the tenant
    * `GET  /api/equipment/:uuid`         — one unit + preloads
    * `POST /api/equipment`               — create (manual entry)
    * `POST /api/equipment/:uuid/events`  — record a lifecycle event
                                            (in_service / moved /
                                            retired / disposed / …)

  All operator-facing errors are mapped to `unprocessable_entity`
  with a stable code so the FE can render structured banners.
  """
  use BackendWeb, :controller

  alias Backend.Equipment
  alias Backend.RBAC
  alias BackendWeb.Errors
  alias BackendWeb.FallbackController
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission,
       "equipment.view"
       when action in [:index, :show, :due_soon, :events_index, :files_index, :file_blob]

  plug RequirePermission, "equipment.create" when action in [:create]

  # Lifecycle event dispatch is multi-kind; the controller enforces
  # per-kind permission after we parse the kind out of the body.
  plug RequirePermission, "equipment.view" when action in [:events_create]

  plug RequirePermission,
       "equipment.act"
       when action in [:file_create, :file_delete]

  action_fallback FallbackController

  def index(conn, _params) do
    actor = conn.assigns.current_user
    units = Equipment.list_for_company(actor.company_id)

    json(conn, %{
      equipment: Enum.map(units, &Payloads.equipment/1),
      total: length(units)
    })
  end

  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Equipment.get_for_company(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      unit ->
        json(conn, %{equipment: Payloads.equipment(unit)})
    end
  end

  @doc """
  Units due for calibration or maintenance within `?horizon_days=N`
  (default 14). Response rows carry the calibration or maintenance
  side alongside the equipment payload so the FE can render "due
  in 3 days" / "3 days overdue" chips without a second fetch.
  """
  def due_soon(conn, params) do
    actor = conn.assigns.current_user

    horizon =
      case params["horizon_days"] do
        n when is_integer(n) and n >= 0 -> n
        b when is_binary(b) ->
          case Integer.parse(b) do
            {n, ""} when n >= 0 -> n
            _ -> 14
          end
        _ -> 14
      end

    rows = Equipment.due_soon(actor.company_id, horizon)

    json(conn, %{
      horizon_days: horizon,
      total: length(rows),
      rows:
        Enum.map(rows, fn row ->
          %{
            due_kind: row.due_kind,
            due_at: row.due_at,
            days_until: row.days_until,
            equipment: Payloads.equipment(row.equipment)
          }
        end)
    })
  end

  def create(conn, params) do
    actor = conn.assigns.current_user

    case Equipment.create(actor, actor.company_id, params) do
      {:ok, unit} ->
        conn
        |> put_status(:created)
        |> json(%{equipment: Payloads.equipment(unit)})

      {:error, :item_not_found} ->
        unprocessable(conn, "item_not_found", "Pick a valid item first.")

      {:error, {:item_wrong_type, t}} ->
        unprocessable(
          conn,
          "item_wrong_type",
          "That item is a #{t}, not equipment. Change the item's type on Settings → Items or pick an equipment item."
        )

      {:error, {:illegal_transition, info}} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "illegal_transition",
            "Equipment couldn't be recorded — internal state machine rejected the birth event (from `#{info.from}` via `#{info.kind}`). Report this to engineering.",
            info
          )
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)

      {:error, reason} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "create_failed",
            "Couldn't create equipment: #{inspect(reason)}."
          )
        )
    end
  end

  def events_create(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user
    kind = params["kind"]

    with :ok <- ensure_kind_permission(actor, kind),
         %Backend.Equipment.Equipment{} = unit <-
           Equipment.get_for_company(actor.company_id, uuid) do
      case Equipment.record_event(actor, unit, kind, event_opts(params)) do
        {:ok, updated} ->
          json(conn, %{equipment: Payloads.equipment(updated)})

        {:error, :illegal_transition, info} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(
            Errors.payload(
              "illegal_transition",
              "That transition isn't allowed from status `#{info.from}`.",
              %{
                from: info.from,
                kind: info.kind,
                allowed: info.allowed
              }
            )
          )

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      {:error, :bad_kind} ->
        unprocessable(conn, "bad_kind", "Event kind is required.")

      {:error, :missing_perm, perm} ->
        conn
        |> put_status(:forbidden)
        |> json(Errors.payload("missing_perm", "You lack the `#{perm}` permission."))

      nil ->
        not_found(conn)
    end
  end

  # Kind → permission dispatch. Read-only kinds don't exist —
  # every event mutates lifecycle state.
  defp ensure_kind_permission(actor, kind) do
    case kind_permission(kind) do
      nil -> {:error, :bad_kind}
      perm -> if RBAC.has_permission?(actor, perm), do: :ok, else: {:error, :missing_perm, perm}
    end
  end

  # Follow-up PRs may split `equipment.calibrate` from
  # `equipment.maintain` for shops that separate the two roles.
  # For now a single `equipment.act` scope covers all lifecycle
  # transitions.
  defp kind_permission(nil), do: nil
  defp kind_permission(""), do: nil
  defp kind_permission(kind) when is_binary(kind), do: "equipment.act"
  defp kind_permission(_), do: nil

  defp event_opts(params) do
    %{
      reason: params["reason"],
      metadata: params["metadata"] || %{},
      from_cell_id: params["from_cell_id"],
      to_cell_id: params["to_cell_id"],
      assigned_to_user_id: params["assigned_to_user_id"]
    }
  end

  defp not_found(conn) do
    conn
    |> put_status(:not_found)
    |> json(Errors.payload("not_found", "Equipment not found."))
  end

  defp unprocessable(conn, code, message, extra \\ %{}) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(Errors.payload(code, message, extra))
  end

  defp changeset_error(conn, cs) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{errors: BackendWeb.ChangesetJSON.error(%{changeset: cs})})
  end

  # ----- events + files ------------------------------------------

  def events_index(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Equipment.get_for_company(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      unit ->
        events = Equipment.list_events(unit)
        json(conn, %{events: Enum.map(events, &Payloads.equipment_event/1)})
    end
  end

  def files_index(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Equipment.get_for_company(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      unit ->
        files = Equipment.list_files(unit)
        json(conn, %{files: Enum.map(files, &Payloads.equipment_file/1)})
    end
  end

  def file_create(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %Backend.Equipment.Equipment{} = unit <-
           Equipment.get_for_company(actor.company_id, uuid) do
      with %Plug.Upload{path: tmp_path, filename: filename, content_type: mime} <-
             params["file"],
           {:ok, bytes} <- Elixir.File.read(tmp_path),
           kind <- params["kind"] || "other",
           {:ok, file} <-
             Equipment.upload_file(
               actor,
               unit,
               %{
                 "kind" => kind,
                 "filename" => filename,
                 "mime" => mime || "application/octet-stream",
                 "byte_size" => byte_size(bytes)
               },
               bytes
             ) do
        conn
        |> put_status(:created)
        |> json(%{file: Payloads.equipment_file(file)})
      else
        nil ->
          unprocessable(
            conn,
            "no_file",
            "Send the file under `file` (multipart)."
          )

        {:error, :enoent} ->
          unprocessable(conn, "no_bytes", "Uploaded file couldn't be read.")

        {:error, {:storage_failed, reason}} ->
          conn
          |> put_status(:internal_server_error)
          |> json(
            Errors.payload(
              "storage_failed",
              "Storage adapter refused the upload: #{inspect(reason)}."
            )
          )

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      nil -> not_found(conn)
    end
  end

  def file_delete(conn, %{"id" => uuid, "file_id" => file_uuid}) do
    actor = conn.assigns.current_user

    with %Backend.Equipment.Equipment{} = unit <-
           Equipment.get_for_company(actor.company_id, uuid),
         %Backend.Equipment.File{} = file <-
           Equipment.get_file(unit, file_uuid),
         {:ok, _} <- Equipment.delete_file(actor, unit, file) do
      send_resp(conn, :no_content, "")
    else
      nil -> not_found(conn)
      {:error, reason} -> unprocessable(conn, "delete_failed", inspect(reason))
    end
  end

  def file_blob(conn, %{"id" => uuid, "file_id" => file_uuid}) do
    actor = conn.assigns.current_user

    with %Backend.Equipment.Equipment{} = unit <-
           Equipment.get_for_company(actor.company_id, uuid),
         %Backend.Equipment.File{} = file <- Equipment.get_file(unit, file_uuid),
         {:ok, bytes} <- Backend.Storage.get(file.blob_path) do
      conn
      |> put_resp_content_type(file.mime)
      |> put_resp_header(
        "content-disposition",
        "attachment; filename=\"#{file.filename}\""
      )
      |> send_resp(200, bytes)
    else
      nil -> not_found(conn)
      {:error, _} -> not_found(conn)
    end
  end
end
