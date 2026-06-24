defmodule BackendWeb.CustomerOrderController do
  @moduledoc """
  Customer-order registry — sell-side mirror of `PurchaseOrderController`.
  Two-tier ESIGN approval. Lines auto-priced from pricelists at
  create time; price snapshot lives on the line so a later pricelist
  edit doesn't retroactively re-quote.

  RBAC:
    * `customer_orders.view`   — index, show, suggest_price, serve_file
    * `customer_orders.create` — create + edit drafts + cancel + line edits + file upload
    * `customer_orders.submit` — submit a draft for approval
    * `customer_orders.approve` — sign as approver tier (1st of 2)
    * `customer_orders.director_approve` — sign as director tier + mark confirmed
    * `customer_orders.delete` — delete drafts + remove files
  """

  use BackendWeb, :controller

  alias Backend.{CustomerOrders, Storage}
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  @allowed_evidence_mimes ~w(application/pdf image/jpeg image/png image/webp
                             application/msword
                             application/vnd.openxmlformats-officedocument.wordprocessingml.document
                             application/vnd.ms-excel
                             application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
                             text/plain)
  @max_evidence_bytes 20 * 1024 * 1024

  plug RequirePermission, "customer_orders.view"
       when action in [:index, :show, :suggest_price, :serve_file]

  plug RequirePermission, "customer_orders.create"
       when action in [
              :create,
              :update,
              :add_line,
              :update_line,
              :delete_line,
              :cancel,
              :upload_file
            ]

  plug RequirePermission, "customer_orders.submit" when action in [:submit]
  plug RequirePermission, "customer_orders.approve" when action in [:sign_approver]

  plug RequirePermission, "customer_orders.director_approve"
       when action in [:sign_director, :mark_confirmed]

  plug RequirePermission, "customer_orders.delete" when action in [:delete, :remove_file]

  action_fallback BackendWeb.FallbackController

  # ----- list / get -----------------------------------------------

  def index(conn, params) do
    actor = conn.assigns.current_user
    opts = list_opts_from_params(params)
    {items, next_cursor} = CustomerOrders.list_page(actor.company_id, opts)

    json(conn, %{
      items: Enum.map(items, &Payloads.customer_order/1),
      next_cursor: next_cursor
    })
  end

  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case CustomerOrders.get_for_company(actor.company_id, uuid) do
      nil -> {:error, :not_found}
      co -> json(conn, %{customer_order: Payloads.customer_order(co)})
    end
  end

  # ----- create / update / delete ---------------------------------

  def create(conn, params) do
    actor = conn.assigns.current_user

    case CustomerOrders.create(actor, actor.company_id, Map.drop(params, ["id"])) do
      {:ok, co} ->
        conn
        |> put_status(:created)
        |> json(%{customer_order: Payloads.customer_order(co)})

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = co <- CustomerOrders.get_for_company(actor.company_id, uuid) do
      case CustomerOrders.update_header(actor, co, Map.drop(params, ["id"])) do
        {:ok, updated} -> json(conn, %{customer_order: Payloads.customer_order(updated)})

        {:error, :bad_status} ->
          conflict(conn, "bad_status", "Only draft customer orders can be edited.")

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def delete(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    with %{} = co <- CustomerOrders.get_for_company(actor.company_id, uuid),
         {:ok, _} <- CustomerOrders.delete(actor, co) do
      send_resp(conn, :no_content, "")
    else
      {:error, :bad_status} ->
        conflict(conn, "bad_status", "Only draft customer orders can be deleted.")

      _ ->
        {:error, :not_found}
    end
  end

  # ----- lines ----------------------------------------------------

  def add_line(conn, %{"customer_order_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = co <- CustomerOrders.get_for_company(actor.company_id, uuid) do
      case CustomerOrders.add_line(actor, co, Map.drop(params, ["customer_order_id"])) do
        {:ok, line} ->
          conn
          |> put_status(:created)
          |> json(%{line: Payloads.customer_order_line(line)})

        {:error, :bad_status} ->
          conflict(conn, "bad_status", "Only draft customer orders can take new lines.")

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def update_line(conn, %{"customer_order_id" => co_uuid, "id" => line_uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = co <- CustomerOrders.get_for_company(actor.company_id, co_uuid),
         %{} = line <- CustomerOrders.get_line(co.id, line_uuid),
         {:ok, updated} <-
           CustomerOrders.update_line(actor, line, Map.drop(params, ["customer_order_id", "id"])) do
      json(conn, %{line: Payloads.customer_order_line(updated)})
    else
      {:error, :bad_status} ->
        conflict(conn, "bad_status", "Only draft customer orders can have lines edited.")

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)

      _ ->
        {:error, :not_found}
    end
  end

  def delete_line(conn, %{"customer_order_id" => co_uuid, "id" => line_uuid}) do
    actor = conn.assigns.current_user

    with %{} = co <- CustomerOrders.get_for_company(actor.company_id, co_uuid),
         %{} = line <- CustomerOrders.get_line(co.id, line_uuid),
         {:ok, _} <- CustomerOrders.delete_line(actor, line) do
      send_resp(conn, :no_content, "")
    else
      {:error, :bad_status} ->
        conflict(conn, "bad_status", "Only draft customer orders can have lines removed.")

      _ ->
        {:error, :not_found}
    end
  end

  def suggest_price(conn, %{"customer_order_id" => co_uuid} = params) do
    actor = conn.assigns.current_user
    raw_item_id = params["item_id"]
    raw_qty = params["qty"] || "1"

    with %{} = co <- CustomerOrders.get_for_company(actor.company_id, co_uuid),
         {item_id, _} <- Integer.parse(to_string(raw_item_id || "")) do
      qty =
        case Decimal.parse(to_string(raw_qty)) do
          {d, _} -> d
          :error -> Decimal.new(1)
        end

      result = CustomerOrders.suggest_line_price(co.customer_id, item_id, qty)
      json(conn, %{suggestion: Payloads.customer_order_price_suggestion(result)})
    else
      :error -> unprocessable(conn, "bad_item_id", "Invalid item id.")
      _ -> {:error, :not_found}
    end
  end

  # ----- state machine --------------------------------------------

  def submit(conn, %{"customer_order_id" => uuid}) do
    actor = conn.assigns.current_user

    with %{} = co <- CustomerOrders.get_for_company(actor.company_id, uuid) do
      case CustomerOrders.submit(actor, co) do
        {:ok, updated} ->
          json(conn, %{customer_order: Payloads.customer_order(updated)})

        {:error, :bad_status} ->
          conflict(conn, "bad_status", "Only draft customer orders can be submitted.")

        {:error, :no_lines} ->
          unprocessable(conn, "no_lines", "Add at least one line first.")

        {:error, :default_warehouse_required} ->
          unprocessable(
            conn,
            "default_warehouse_required",
            "Pick a default warehouse on the CO header before submitting."
          )

        {:error, :customer_not_approved} ->
          unprocessable(
            conn,
            "customer_not_approved",
            "Customer must be effectively approved (not draft, suspended, rejected, inactive, or overdue for re-qualification) to take orders."
          )

        {:error, {:items_not_sellable, ids}} ->
          unprocessable(
            conn,
            "items_not_sellable",
            "These items are not on the customer's approved-products list: " <>
              Enum.map_join(ids, ", ", &"##{&1}") <>
              ". Add them via the customer's Approved Products card, or remove them from this CO."
          )

        {:error, {:credit_limit_breached, info}} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{
            error: "credit_limit_breached",
            detail:
              "This CO would push outstanding A/R past the customer's trade credit limit. " <>
                "Outstanding: #{Decimal.to_string(info.outstanding)}; " <>
                "with this CO: #{Decimal.to_string(info.total)}; " <>
                "limit: #{Decimal.to_string(info.limit)}.",
            outstanding: info.outstanding,
            total: info.total,
            limit: info.limit
          })

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def sign_approver(conn, %{"customer_order_id" => uuid} = params) do
    actor = conn.assigns.current_user
    opts = Map.take(params, ["notes", "signature_image"])

    with %{} = co <- CustomerOrders.get_for_company(actor.company_id, uuid) do
      case CustomerOrders.sign_approver(actor, co, opts) do
        {:ok, updated} ->
          json(conn, %{customer_order: Payloads.customer_order(updated)})

        {:error, :bad_status} ->
          conflict(conn, "bad_status", "CO is not awaiting approver sign-off.")

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def sign_director(conn, %{"customer_order_id" => uuid} = params) do
    actor = conn.assigns.current_user
    opts = Map.take(params, ["notes", "signature_image"])

    with %{} = co <- CustomerOrders.get_for_company(actor.company_id, uuid) do
      case CustomerOrders.sign_director(actor, co, opts) do
        {:ok, updated} ->
          json(conn, %{customer_order: Payloads.customer_order(updated)})

        {:error, :bad_status} ->
          conflict(conn, "bad_status", "CO is not awaiting director sign-off.")

        {:error, :same_signer} ->
          conflict(
            conn,
            "same_signer",
            "Director sign-off must be a different user from the approver-tier signer."
          )

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def mark_confirmed(conn, %{"customer_order_id" => uuid}) do
    actor = conn.assigns.current_user

    with %{} = co <- CustomerOrders.get_for_company(actor.company_id, uuid) do
      case CustomerOrders.mark_confirmed(actor, co) do
        {:ok, updated} ->
          json(conn, %{customer_order: Payloads.customer_order(updated)})

        {:error, :bad_status} ->
          conflict(conn, "bad_status", "Only approved customer orders can be confirmed.")

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def cancel(conn, %{"customer_order_id" => uuid} = params) do
    actor = conn.assigns.current_user
    reason = params["reason"] || ""

    cond do
      reason == "" ->
        unprocessable(conn, "reason_required", "Cancellation reason is required.")

      true ->
        with %{} = co <- CustomerOrders.get_for_company(actor.company_id, uuid) do
          case CustomerOrders.cancel(actor, co, reason) do
            {:ok, updated} ->
              json(conn, %{customer_order: Payloads.customer_order(updated)})

            {:error, :bad_status} ->
              conflict(
                conn,
                "bad_status",
                "Already terminal (or confirmed) — can't cancel."
              )

            {:error, %Ecto.Changeset{} = cs} ->
              changeset_error(conn, cs)
          end
        else
          _ -> {:error, :not_found}
        end
    end
  end

  # ----- file upload + serve --------------------------------------

  def upload_file(
        conn,
        %{"customer_order_id" => uuid, "file" => %Plug.Upload{} = upload} = params
      ) do
    actor = conn.assigns.current_user
    kind = params["kind"] || "other"

    with %{} = co <- CustomerOrders.get_for_company(actor.company_id, uuid),
         :ok <- validate_evidence_mime(upload.content_type),
         {:ok, bytes} <- read_upload(upload),
         :ok <- validate_evidence_size(bytes) do
      key = build_storage_key(co, kind, upload)

      case Storage.put(key, bytes, content_type: upload.content_type) do
        {:ok, blob_path} ->
          attrs = %{
            "kind" => kind,
            "filename" => upload.filename || "upload",
            "mime" => upload.content_type || "application/octet-stream",
            "byte_size" => byte_size(bytes),
            "blob_path" => blob_path
          }

          case CustomerOrders.record_file(actor, co, attrs) do
            {:ok, file} ->
              conn
              |> put_status(:created)
              |> json(%{file: Payloads.customer_order_file(file, co)})

            {:error, %Ecto.Changeset{} = cs} ->
              changeset_error(conn, cs)
          end

        {:error, reason} ->
          unprocessable(
            conn,
            "storage_failed",
            "Couldn't store the file (#{inspect(reason)})."
          )
      end
    else
      nil -> {:error, :not_found}
      {:error, {:invalid_mime, detail}} -> unprocessable(conn, "invalid_mime_type", detail)
      {:error, {:too_large, bytes}} -> file_too_large(conn, bytes)
      {:error, {:read_failed, reason}} ->
        unprocessable(conn, "read_failed", "Couldn't read the upload: #{inspect(reason)}.")
    end
  end

  def upload_file(conn, _params) do
    unprocessable(conn, "missing_file", "Send the file under `file` (multipart).")
  end

  def serve_file(conn, %{"customer_order_id" => co_uuid, "id" => file_uuid}) do
    actor = conn.assigns.current_user

    with %{} = co <- CustomerOrders.get_for_company(actor.company_id, co_uuid),
         %{} = file <- CustomerOrders.get_file(co.id, file_uuid),
         abs_path = Backend.Storage.Local.absolute_path(file.blob_path),
         true <- File.exists?(abs_path) do
      conn
      |> put_resp_content_type(file.mime || "application/octet-stream")
      |> put_resp_header(
        "content-disposition",
        ~s|inline; filename="#{file.filename}"|
      )
      |> send_file(200, abs_path)
    else
      _ -> {:error, :not_found}
    end
  end

  def remove_file(conn, %{"customer_order_id" => co_uuid, "id" => file_uuid}) do
    actor = conn.assigns.current_user

    with %{} = co <- CustomerOrders.get_for_company(actor.company_id, co_uuid),
         %{} = file <- CustomerOrders.get_file(co.id, file_uuid),
         {:ok, _} <- CustomerOrders.remove_file(actor, file) do
      send_resp(conn, :no_content, "")
    else
      _ -> {:error, :not_found}
    end
  end

  # ----- helpers ---------------------------------------------------

  defp list_opts_from_params(params) do
    [
      cursor: params["cursor"],
      limit: params["limit"],
      sort: parse_sort(params["sort"]),
      search: params["search"],
      status: params["status"],
      customer_id: params["customer_id"]
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

  defp validate_evidence_mime(mime) when mime in @allowed_evidence_mimes, do: :ok

  defp validate_evidence_mime(mime) do
    {:error,
     {:invalid_mime,
      "Unsupported file type (#{mime || "unknown"}). Allowed: PDF, images, Word, Excel, plain text."}}
  end

  defp validate_evidence_size(bytes) when byte_size(bytes) > @max_evidence_bytes do
    {:error, {:too_large, byte_size(bytes)}}
  end

  defp validate_evidence_size(_), do: :ok

  defp read_upload(%Plug.Upload{path: path}) do
    case File.read(path) do
      {:ok, bytes} -> {:ok, bytes}
      {:error, reason} -> {:error, {:read_failed, reason}}
    end
  end

  defp build_storage_key(co, kind, %Plug.Upload{filename: filename}) do
    "customer_order_files/" <>
      co.uuid <>
      "/" <>
      kind <>
      "_" <>
      Ecto.UUID.generate() <>
      extension_for(filename)
  end

  defp extension_for(nil), do: ""

  defp extension_for(filename) when is_binary(filename) do
    case Path.extname(filename) do
      "" -> ""
      ext -> String.downcase(ext)
    end
  end

  defp file_too_large(conn, bytes) do
    mb = Float.round(bytes / 1024 / 1024, 1)
    max_mb = Float.round(@max_evidence_bytes / 1024 / 1024, 1)

    unprocessable(
      conn,
      "file_too_large",
      "File is #{mb} MB; max allowed is #{max_mb} MB."
    )
  end

  defp conflict(conn, code, detail) do
    conn |> put_status(:conflict) |> json(Errors.payload(code, detail))
  end

  defp unprocessable(conn, code, detail) do
    conn |> put_status(:unprocessable_entity) |> json(Errors.payload(code, detail))
  end

  defp changeset_error(conn, cs) do
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
