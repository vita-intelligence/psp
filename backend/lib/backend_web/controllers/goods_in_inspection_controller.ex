defmodule BackendWeb.GoodsInInspectionController do
  @moduledoc """
  Goods-In Inspection endpoints — BRCGS / FSSC 22000 incoming-goods
  inspection workflow.

  Two-signature flow (segregation of duties):

    * `goods_in.inspect` — creates draft, fills sections + line
      decisions, signs as the goods-in operator.
    * `goods_in.approve` — signs as the quality approver. Must be a
      different user from the operator.
  """

  use BackendWeb, :controller

  import Ecto.Query, only: [from: 2]

  alias Backend.GoodsIn
  alias Backend.GoodsIn.Inspection
  alias Backend.Purchasing
  alias Backend.Purchasing.PurchaseOrderLine
  alias Backend.Repo
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "goods_in.view"
       when action in [:index, :index_global, :show, :serve_file]

  plug RequirePermission, "goods_in.inspect"
       when action in [
              :create,
              :update,
              :upsert_item,
              :sign_operator,
              :upload_file,
              :delete_file
            ]

  plug RequirePermission, "goods_in.approve"
       when action in [:sign_quality]

  action_fallback BackendWeb.FallbackController

  # ----- list / show ------------------------------------------------

  @doc """
  List inspections for one PO (multi-delivery view).
  """
  def index(conn, %{"purchase_order_id" => po_uuid}) do
    actor = conn.assigns.current_user

    with %{} = po <- Purchasing.get_for_company(actor.company_id, po_uuid) do
      inspections = GoodsIn.list_for_po(actor.company_id, po.id)
      json(conn, %{items: Enum.map(inspections, &Payloads.goods_in_inspection/1)})
    else
      _ -> {:error, :not_found}
    end
  end

  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case GoodsIn.get(actor.company_id, uuid) do
      nil -> {:error, :not_found}
      inspection -> json(conn, %{goods_in_inspection: Payloads.goods_in_inspection(inspection)})
    end
  end

  @doc """
  Global "Inspections ledger" — paginated list of every inspection
  for the company. Mirrors the procurement-invoice global ledger
  shape so the desktop tables feel the same.
  """
  def index_global(conn, params) do
    actor = conn.assigns.current_user

    opts =
      [
        cursor: params["cursor"],
        limit: params["limit"],
        sort: parse_sort(params["sort"]),
        search: params["search"],
        column_filter: params["column_filter"],
        status: params["status"],
        purchase_order_id: parse_int(params["purchase_order_id"]),
        warehouse_id: parse_int(params["warehouse_id"]),
        from_date: parse_date(params["from_date"]),
        to_date: parse_date(params["to_date"]),
        # `mine=true` resolves to the authenticated user's id at the
        # controller boundary — the context layer stays user-agnostic
        # so the FE doesn't have to know its own id.
        actor_id: parse_actor_id(params["mine"], actor)
      ]
      |> Enum.reject(fn {_k, v} -> is_nil(v) end)

    {items, next_cursor} = GoodsIn.list_page(actor.company_id, opts)

    json(conn, %{
      items: Enum.map(items, &Payloads.goods_in_inspection_summary/1),
      next_cursor: next_cursor
    })
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

  defp parse_int(nil), do: nil
  defp parse_int(""), do: nil
  defp parse_int(n) when is_integer(n), do: n

  defp parse_int(raw) when is_binary(raw) do
    case Integer.parse(raw) do
      {n, ""} -> n
      _ -> nil
    end
  end

  defp parse_int(_), do: nil

  # Resolve viewer-relative actor params (`mine`, `awaiting_signoff_from`)
  # to the authenticated user's id. Accepts the usual truthy strings +
  # the literal "me" so the FE can read more naturally
  # (`awaiting_signoff_from=me`). Anything else falls through to `nil`.
  defp parse_actor_id(raw, %{id: id})
       when raw in ["true", "1", "me", true, 1],
       do: id

  defp parse_actor_id(_, _), do: nil

  defp parse_date(nil), do: nil
  defp parse_date(""), do: nil

  defp parse_date(raw) when is_binary(raw) do
    case Date.from_iso8601(raw) do
      {:ok, d} -> d
      _ -> nil
    end
  end

  defp parse_date(_), do: nil

  # ----- create draft ----------------------------------------------

  def create(conn, %{"purchase_order_id" => po_uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = po <- Purchasing.get_for_company(actor.company_id, po_uuid),
         {:ok, inspection} <-
           GoodsIn.create_draft(actor, po, Map.drop(params, ["purchase_order_id"])) do
      conn
      |> put_status(:created)
      |> json(%{goods_in_inspection: Payloads.goods_in_inspection(inspection)})
    else
      nil -> {:error, :not_found}
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  # ----- update (delivery info + section JSONBs) -------------------

  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    case GoodsIn.get(actor.company_id, uuid) do
      nil ->
        {:error, :not_found}

      inspection ->
        update_dispatch(conn, actor, inspection, Map.drop(params, ["id"]))
    end
  end

  # If the body carries a `section` + `value`, we patch one of the
  # JSONB section columns. Otherwise we patch delivery-info section 1.
  defp update_dispatch(conn, actor, %Inspection{} = i, %{"section" => section_str, "value" => value})
       when is_map(value) do
    section = String.to_existing_atom(section_str)

    case GoodsIn.update_section(actor, i, section, value) do
      {:ok, updated} ->
        json(conn, %{goods_in_inspection: Payloads.goods_in_inspection(updated)})

      {:error, :not_editable} ->
        conflict(conn, "not_editable", "Inspection is no longer in draft.")

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  rescue
    ArgumentError ->
      unprocessable(conn, "bad_section", "Unknown section name.")
  end

  defp update_dispatch(conn, actor, %Inspection{} = i, attrs) do
    case GoodsIn.update_delivery_info(actor, i, attrs) do
      {:ok, updated} ->
        json(conn, %{goods_in_inspection: Payloads.goods_in_inspection(updated)})

      {:error, :not_editable} ->
        conflict(conn, "not_editable", "Inspection is no longer in draft.")

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  # ----- per-line item decisions -----------------------------------

  def upsert_item(conn, %{"goods_in_inspection_id" => uuid, "line_uuid" => line_uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = inspection <- GoodsIn.get(actor.company_id, uuid),
         %{} = line <- fetch_po_line(inspection.purchase_order_id, line_uuid),
         {:ok, item} <-
           GoodsIn.upsert_item_decision(
             actor,
             inspection,
             line,
             Map.drop(params, ["goods_in_inspection_id", "line_uuid"])
           ) do
      json(conn, %{inspection_item: Payloads.goods_in_inspection_item(item)})
    else
      nil ->
        {:error, :not_found}

      {:error, :not_editable} ->
        conflict(conn, "not_editable", "Inspection is no longer in draft.")

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  # ----- signatures ------------------------------------------------

  def sign_operator(conn, %{"goods_in_inspection_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = inspection <- GoodsIn.get(actor.company_id, uuid),
         {:ok, signed} <-
           GoodsIn.sign_operator(
             actor,
             inspection,
             Map.drop(params, ["goods_in_inspection_id"])
           ) do
      json(conn, %{goods_in_inspection: Payloads.goods_in_inspection(signed)})
    else
      nil ->
        {:error, :not_found}

      {:error, :not_editable} ->
        conflict(
          conn,
          "not_editable",
          "Inspection is no longer in draft — can't operator-sign."
        )

      {:error, {:lines_undecided, missing}} ->
        unprocessable(
          conn,
          "lines_undecided",
          "Decide every PO line before signing as operator (#{length(missing)} undecided)."
        )

      {:error, {:sections_incomplete, missing}} ->
        unprocessable(
          conn,
          "sections_incomplete",
          "Fill every section before signing as operator (missing: #{Enum.join(Enum.map(missing, &Atom.to_string/1), ", ")})."
        )

      # Stock-lot materialisation failed during sign-off. Surfaces the
      # validation rather than 500-ing the whole flow, so the operator
      # sees what to fix (typically an over-cap stack_factor or qty).
      # The structured fields let the FE wire a "Go to pack" button
      # straight back to the right line + pack index.
      {:error, {:lot_create_failed, line_uuid, idx, %Ecto.Changeset{} = cs}} ->
        item_label = po_line_item_label(line_uuid)

        unprocessable(
          conn,
          "lot_create_failed",
          "Couldn't create a stock lot for #{item_label} (pack ##{idx + 1}). #{lot_changeset_summary(cs)}",
          # Wrapped in single-element lists because the standard
          # `fields` envelope on the FE is typed Record<string,
          # string[]> — single values still round-trip.
          %{
            "line_uuid" => [line_uuid],
            "pack_index" => [Integer.to_string(idx)],
            "item_label" => [item_label]
          }
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  defp lot_changeset_summary(%Ecto.Changeset{errors: errors}) do
    errors
    |> Enum.take(2)
    |> Enum.map(fn {field, {msg, opts}} ->
      formatted =
        Enum.reduce(opts, msg, fn {k, v}, acc ->
          String.replace(acc, "%{#{k}}", to_string(v))
        end)

      "#{field}: #{formatted}"
    end)
    |> Enum.join("; ")
  end

  # Render "<item code> – <item name>" for the PO line so the operator
  # immediately recognises which product the validation tripped on.
  # Falls back gracefully through any partial state — never crashes
  # because of a missing item / preload.
  defp po_line_item_label(line_uuid) do
    case Backend.Repo.get_by(Backend.Purchasing.PurchaseOrderLine,
           uuid: line_uuid
         ) do
      nil ->
        "an unknown PO line"

      %{item_id: nil} ->
        "an item that's no longer linked"

      %{item_id: item_id} ->
        case Backend.Repo.get(Backend.Items.Item, item_id) do
          nil ->
            "Item ##{item_id}"

          item ->
            code = Payloads.render_entity_code(item, "item")

            cond do
              item.name && code -> "#{code} – #{item.name}"
              item.name -> item.name
              code -> code
              true -> "Item ##{item_id}"
            end
        end
    end
  end

  def sign_quality(conn, %{"goods_in_inspection_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = inspection <- GoodsIn.get(actor.company_id, uuid),
         {:ok, signed} <-
           GoodsIn.sign_quality_approver(
             actor,
             inspection,
             Map.drop(params, ["goods_in_inspection_id"])
           ) do
      json(conn, %{goods_in_inspection: Payloads.goods_in_inspection(signed)})
    else
      nil ->
        {:error, :not_found}

      {:error, :not_submitted} ->
        conflict(
          conn,
          "not_submitted",
          "Inspection isn't awaiting quality sign-off."
        )

      {:error, {:illegal_transition, info}} ->
        unprocessable(
          conn,
          "illegal_transition",
          "Couldn't transition a linked lot: #{inspect(info)}."
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  # ----- file attachments ------------------------------------------

  @doc """
  Multipart upload for an inspection attachment (operator photo, COA
  PDF, other supporting evidence). Bytes go through `Backend.Storage`;
  the metadata row scopes by inspection so files only resolve under
  their owning record.

  Allowed only while the inspection is mutable (draft | submitted).
  """
  def upload_file(conn, %{"goods_in_inspection_id" => uuid, "file" => %Plug.Upload{} = upload} = params) do
    actor = conn.assigns.current_user
    kind = params["kind"] || "photo"

    with %{} = inspection <- GoodsIn.get(actor.company_id, uuid),
         {:ok, file} <- GoodsIn.upload_file(actor, inspection, kind, upload) do
      conn
      |> put_status(:created)
      |> json(%{file: Payloads.goods_in_inspection_file(file, inspection)})
    else
      nil ->
        {:error, :not_found}

      {:error, :not_editable} ->
        conflict(
          conn,
          "not_editable",
          "Inspection is locked — can't attach more files."
        )

      {:error, {:invalid_mime, detail}} ->
        unprocessable(conn, "invalid_mime_type", detail)

      {:error, {:too_large, bytes}} ->
        file_too_large(conn, bytes)

      {:error, {:read_failed, reason}} ->
        unprocessable(
          conn,
          "read_failed",
          "Couldn't read the upload: #{inspect(reason)}."
        )

      {:error, {:storage_failed, reason}} ->
        unprocessable(
          conn,
          "storage_failed",
          "Couldn't store the file (#{inspect(reason)})."
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def upload_file(conn, _params) do
    unprocessable(conn, "missing_file", "Send the file under `file` (multipart).")
  end

  def delete_file(conn, %{"goods_in_inspection_id" => uuid, "id" => file_uuid}) do
    actor = conn.assigns.current_user

    with %{} = inspection <- GoodsIn.get(actor.company_id, uuid),
         {:ok, _} <- GoodsIn.delete_file(actor, inspection, file_uuid) do
      send_resp(conn, :no_content, "")
    else
      nil ->
        {:error, :not_found}

      {:error, :not_found} ->
        {:error, :not_found}

      {:error, :not_editable} ->
        conflict(
          conn,
          "not_editable",
          "Inspection is locked — can't remove files."
        )
    end
  end

  @doc """
  Stream an inspection file back. Same path-resolver as the PO file
  serve — local adapter reads from disk, cloud adapters short-circuit
  to a signed URL upstream.
  """
  # See vendor_controller.serve_file/2 for the safety rationale.
  def serve_file(conn, %{"goods_in_inspection_id" => uuid, "id" => file_uuid}) do
    actor = conn.assigns.current_user

    with %{} = file <- GoodsIn.get_file(actor.company_id, uuid, file_uuid),
         abs_path = Backend.Storage.Local.absolute_path(file.blob_path),
         true <- File.exists?(abs_path) do
      conn
      |> put_resp_content_type(file.mime || "application/octet-stream")
      |> put_resp_header(
        "content-disposition",
        Backend.Http.ContentDisposition.header(:inline, file.filename)
      )
      |> send_file(200, abs_path)
    else
      _ -> {:error, :not_found}
    end
  end

  defp file_too_large(conn, bytes) do
    mb = Float.round(bytes / 1024 / 1024, 1)
    max_mb = Float.round(GoodsIn.max_file_bytes() / 1024 / 1024, 1)

    unprocessable(
      conn,
      "file_too_large",
      "File is #{mb} MB; max allowed is #{max_mb} MB."
    )
  end

  # ----- helpers ---------------------------------------------------

  defp fetch_po_line(po_id, line_uuid) when is_binary(line_uuid) do
    case Ecto.UUID.cast(line_uuid) do
      {:ok, cast} ->
        Repo.one(
          from(l in PurchaseOrderLine,
            where: l.purchase_order_id == ^po_id and l.uuid == ^cast
          )
        )

      :error ->
        nil
    end
  end

  defp fetch_po_line(_, _), do: nil

  defp changeset_error(conn, %Ecto.Changeset{} = cs) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(Errors.payload("validation_failed", "Please correct the highlighted fields.", %{errors: format_errors(cs)}))
  end

  defp format_errors(%Ecto.Changeset{} = cs) do
    Ecto.Changeset.traverse_errors(cs, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc ->
        String.replace(acc, "%{#{k}}", to_string(v))
      end)
    end)
  end

  defp conflict(conn, code, detail) do
    conn
    |> put_status(:conflict)
    |> json(Errors.payload(code, detail, %{}))
  end

  defp unprocessable(conn, code, detail, fields \\ %{}) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(Errors.payload(code, detail, fields))
  end
end
