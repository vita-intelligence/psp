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
       when action in [:file_create, :file_delete, :move]

  action_fallback FallbackController

  def index(conn, params) do
    actor = conn.assigns.current_user
    opts = list_opts_from_params(params)
    {items, next_cursor} = Equipment.list_page(actor.company_id, opts)

    json(conn, %{
      items: Enum.map(items, &Payloads.equipment/1),
      next_cursor: next_cursor
    })
  end

  defp list_opts_from_params(params) do
    [
      cursor: params["cursor"],
      limit: params["limit"],
      sort: parse_sort(params["sort"]),
      search: params["search"],
      column_filter: params["column_filter"],
      workstation_id: params["workstation_id"]
    ]
  end

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

  @doc """
  Move an equipment unit to a specific storage cell (or clear the
  cell + set a free-text location for office kit). Wraps the
  ``moved`` lifecycle event so the timeline reads coherently.

  Body:
      {
        "to_cell_uuid": "…",              # or null to clear
        "location_description": "…",       # optional free-text for
                                           # off-floor placements
        "reason": "…"                      # optional audit note
      }
  """
  def move(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %Backend.Equipment.Equipment{} = unit <-
           Equipment.get_for_company(actor.company_id, uuid),
         {:ok, to_cell_id} <- resolve_cell(actor.company_id, params["to_cell_uuid"]) do
      # Emit a ``moved`` event so the timeline captures the
      # from → to transition. Lifecycle side-effects update
      # equipment.current_cell_id + clear location_description
      # inside the same transaction.
      event_attrs = %{
        reason: params["reason"] || build_move_reason(to_cell_id),
        from_cell_id: unit.current_cell_id,
        to_cell_id: to_cell_id
      }

      case Equipment.record_event(actor, unit, "moved", event_attrs) do
        {:ok, updated_after_event} ->
          # If the operator also provided a free-text location
          # (usually when clearing to null), apply it as a plain
          # changeset update so the move + descriptor land atomically
          # from the client's view.
          case params["location_description"] do
            v when is_binary(v) ->
              trimmed = if String.trim(v) == "", do: nil, else: String.trim(v)

              updated_after_event
              |> Ecto.Changeset.change(location_description: trimmed)
              |> Backend.Repo.update()
              |> case do
                {:ok, final} ->
                  final = Backend.Repo.preload(final, [:workstation, :current_cell])
                  json(conn, %{equipment: Payloads.equipment(final)})

                {:error, %Ecto.Changeset{} = cs} ->
                  changeset_error(conn, cs)
              end

            _ ->
              final = Backend.Repo.preload(updated_after_event, [:workstation, :current_cell])
              json(conn, %{equipment: Payloads.equipment(final)})
          end

        {:error, :illegal_transition, info} ->
          unprocessable(conn, "illegal_transition",
            "That move isn't allowed from status `#{info.from}`.",
            info
          )

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      {:error, :cell_not_found} ->
        unprocessable(conn, "cell_not_found",
          "Storage cell not found in your company.")

      nil ->
        not_found(conn)
    end
  end

  defp build_move_reason(nil), do: "Removed from storage cell"
  defp build_move_reason(_id), do: "Moved to storage cell"

  # Resolve a cell UUID → integer id inside the actor's tenant. Nil /
  # blank string → nil (explicit "clear cell"). Anything else that
  # doesn't match a cell → error so the operator sees a message.
  defp resolve_cell(_company_id, nil), do: {:ok, nil}
  defp resolve_cell(_company_id, ""), do: {:ok, nil}

  defp resolve_cell(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        cell =
          Backend.Warehouses.StorageCell
          |> Backend.Repo.get_by(uuid: cast, company_id: company_id)

        case cell do
          nil -> {:error, :cell_not_found}
          %{id: id} -> {:ok, id}
        end

      _ ->
        {:error, :cell_not_found}
    end
  end

  defp resolve_cell(_company_id, _), do: {:error, :cell_not_found}

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
      # ``inline`` lets the browser preview PDFs / images in a new
      # tab (which is what operators expect when they click a
      # calibration certificate). Right-click still offers download.
      # Non-previewable MIME types will naturally fall back to a
      # download prompt.
      conn
      |> put_resp_content_type(file.mime)
      |> put_resp_header(
        "content-disposition",
        "inline; filename=\"#{file.filename}\""
      )
      |> send_resp(200, bytes)
    else
      nil -> not_found(conn)
      {:error, _} -> not_found(conn)
    end
  end
end
