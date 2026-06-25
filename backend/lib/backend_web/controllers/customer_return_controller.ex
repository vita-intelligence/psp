defmodule BackendWeb.CustomerReturnController do
  @moduledoc """
  Customer returns (RMAs). Sell-side post-shipment workflow.

  RBAC:
    * `customer_returns.view`     — index, show, serve_file
    * `customer_returns.create`   — create + edit drafts + line edits + cancel + upload_file
    * `customer_returns.receive`  — mark_received
    * `customer_returns.resolve`  — accept (with credit note) + reject
    * `customer_returns.delete`   — delete draft + remove_file
  """

  use BackendWeb, :controller

  alias Backend.{CustomerReturns, Storage}
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  @allowed_evidence_mimes ~w(application/pdf image/jpeg image/png image/webp
                             application/msword
                             application/vnd.openxmlformats-officedocument.wordprocessingml.document
                             text/plain)
  @max_evidence_bytes 20 * 1024 * 1024

  plug RequirePermission, "customer_returns.view"
       when action in [:index, :show, :serve_file]

  plug RequirePermission, "customer_returns.create"
       when action in [
              :create,
              :update,
              :add_line,
              :update_line,
              :delete_line,
              :cancel,
              :upload_file
            ]

  plug RequirePermission, "customer_returns.receive"
       when action in [:mark_received]

  plug RequirePermission, "customer_returns.resolve"
       when action in [:accept, :reject]

  plug RequirePermission, "customer_returns.delete"
       when action in [:delete, :remove_file]

  action_fallback BackendWeb.FallbackController

  # ----- list / get -----------------------------------------------

  def index(conn, params) do
    actor = conn.assigns.current_user
    opts = list_opts_from_params(params)
    {items, next_cursor} = CustomerReturns.list_page(actor.company_id, opts)

    json(conn, %{
      items: Enum.map(items, &Payloads.customer_return/1),
      next_cursor: next_cursor
    })
  end

  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case CustomerReturns.get_for_company(actor.company_id, uuid) do
      nil ->
        {:error, :not_found}

      rma ->
        credit_note =
          case CustomerReturns.credit_note_for(rma) do
            nil ->
              nil

            cn ->
              cn
              |> Backend.Repo.preload([:customer, :customer_order])
              |> Payloads.customer_invoice()
          end

        json(conn, %{
          customer_return: Payloads.customer_return(rma),
          credit_note: credit_note
        })
    end
  end

  # ----- create / update / delete ---------------------------------

  def create(conn, params) do
    actor = conn.assigns.current_user

    case CustomerReturns.create(actor, actor.company_id, Map.drop(params, ["id"])) do
      {:ok, rma} ->
        conn
        |> put_status(:created)
        |> json(%{customer_return: Payloads.customer_return(rma)})

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = rma <- CustomerReturns.get_for_company(actor.company_id, uuid) do
      case CustomerReturns.update_header(actor, rma, Map.drop(params, ["id"])) do
        {:ok, updated} ->
          json(conn, %{customer_return: Payloads.customer_return(updated)})

        {:error, :bad_status} ->
          conflict(conn, "bad_status", "Only draft RMAs can be edited.")

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def delete(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    with %{} = rma <- CustomerReturns.get_for_company(actor.company_id, uuid),
         {:ok, _} <- CustomerReturns.delete(actor, rma) do
      send_resp(conn, :no_content, "")
    else
      {:error, :bad_status} ->
        conflict(conn, "bad_status", "Only draft RMAs can be deleted.")

      _ ->
        {:error, :not_found}
    end
  end

  # ----- lines ----------------------------------------------------

  def add_line(conn, %{"customer_return_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = rma <- CustomerReturns.get_for_company(actor.company_id, uuid) do
      case CustomerReturns.add_line(
             actor,
             rma,
             Map.drop(params, ["customer_return_id"])
           ) do
        {:ok, line} ->
          conn
          |> put_status(:created)
          |> json(%{line: Payloads.customer_return_line(line)})

        {:error, :bad_status} ->
          conflict(conn, "bad_status", "Only draft RMAs can take new lines.")

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def update_line(conn, %{"customer_return_id" => r_uuid, "id" => l_uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = rma <- CustomerReturns.get_for_company(actor.company_id, r_uuid),
         %{} = line <- CustomerReturns.get_line(rma.id, l_uuid),
         {:ok, updated} <-
           CustomerReturns.update_line(
             actor,
             line,
             Map.drop(params, ["customer_return_id", "id"])
           ) do
      json(conn, %{line: Payloads.customer_return_line(updated)})
    else
      {:error, :bad_status} ->
        conflict(conn, "bad_status", "RMA is terminal; lines can't be edited.")

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)

      _ ->
        {:error, :not_found}
    end
  end

  def delete_line(conn, %{"customer_return_id" => r_uuid, "id" => l_uuid}) do
    actor = conn.assigns.current_user

    with %{} = rma <- CustomerReturns.get_for_company(actor.company_id, r_uuid),
         %{} = line <- CustomerReturns.get_line(rma.id, l_uuid),
         {:ok, _} <- CustomerReturns.delete_line(actor, line) do
      send_resp(conn, :no_content, "")
    else
      {:error, :bad_status} ->
        conflict(conn, "bad_status", "Only draft RMAs can have lines removed.")

      _ ->
        {:error, :not_found}
    end
  end

  # ----- state machine --------------------------------------------

  def mark_received(conn, %{"customer_return_id" => uuid}) do
    actor = conn.assigns.current_user

    with %{} = rma <- CustomerReturns.get_for_company(actor.company_id, uuid) do
      case CustomerReturns.mark_received(actor, rma) do
        {:ok, updated} ->
          json(conn, %{customer_return: Payloads.customer_return(updated)})

        {:error, :bad_status} ->
          conflict(conn, "bad_status", "Only draft RMAs can be marked received.")

        {:error, :no_lines} ->
          unprocessable(conn, "no_lines", "Add at least one line first.")

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def accept(conn, %{"customer_return_id" => uuid} = params) do
    actor = conn.assigns.current_user
    opts = Map.take(params, ["line_decisions", "issue_credit_note"])

    with %{} = rma <- CustomerReturns.get_for_company(actor.company_id, uuid) do
      case CustomerReturns.accept(actor, rma, opts) do
        {:ok, %{rma: updated, credit_note: cn}} ->
          json(conn, %{
            customer_return: Payloads.customer_return(updated),
            credit_note: cn && Payloads.customer_invoice(cn)
          })

        {:error, :bad_status} ->
          conflict(conn, "bad_status", "Only received RMAs can be accepted.")

        {:error, :no_accepted_qty} ->
          unprocessable(
            conn,
            "no_accepted_qty",
            "At least one line needs a non-zero accepted qty before the RMA can be accepted. Use Reject if nothing was salvageable."
          )

        {:error, :no_accepted_lines} ->
          unprocessable(
            conn,
            "no_accepted_lines",
            "No lines have accepted qty — the credit note would be empty."
          )

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def reject(conn, %{"customer_return_id" => uuid} = params) do
    actor = conn.assigns.current_user
    reason = params["reason"] || ""

    cond do
      reason == "" ->
        unprocessable(conn, "reason_required", "Rejection reason is required.")

      true ->
        with %{} = rma <- CustomerReturns.get_for_company(actor.company_id, uuid) do
          case CustomerReturns.reject(actor, rma, reason) do
            {:ok, updated} ->
              json(conn, %{customer_return: Payloads.customer_return(updated)})

            {:error, :bad_status} ->
              conflict(conn, "bad_status", "RMA is already terminal.")

            {:error, %Ecto.Changeset{} = cs} ->
              changeset_error(conn, cs)
          end
        else
          _ -> {:error, :not_found}
        end
    end
  end

  def cancel(conn, %{"customer_return_id" => uuid} = params) do
    actor = conn.assigns.current_user
    reason = params["reason"] || ""

    cond do
      reason == "" ->
        unprocessable(conn, "reason_required", "Cancellation reason is required.")

      true ->
        with %{} = rma <- CustomerReturns.get_for_company(actor.company_id, uuid) do
          case CustomerReturns.cancel(actor, rma, reason) do
            {:ok, updated} ->
              json(conn, %{customer_return: Payloads.customer_return(updated)})

            {:error, :bad_status} ->
              conflict(conn, "bad_status", "RMA is already terminal.")

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
        %{"customer_return_id" => uuid, "file" => %Plug.Upload{} = upload} = params
      ) do
    actor = conn.assigns.current_user
    kind = params["kind"] || "photo"

    with %{} = rma <- CustomerReturns.get_for_company(actor.company_id, uuid),
         :ok <- validate_evidence_mime(upload.content_type),
         {:ok, bytes} <- read_upload(upload),
         :ok <- validate_evidence_size(bytes) do
      key = build_storage_key(rma, kind, upload)

      case Storage.put(key, bytes, content_type: upload.content_type) do
        {:ok, blob_path} ->
          attrs = %{
            "kind" => kind,
            "filename" => upload.filename || "upload",
            "mime" => upload.content_type || "application/octet-stream",
            "byte_size" => byte_size(bytes),
            "blob_path" => blob_path
          }

          case CustomerReturns.record_file(actor, rma, attrs) do
            {:ok, file} ->
              conn
              |> put_status(:created)
              |> json(%{file: Payloads.customer_return_file(file, rma)})

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

  def serve_file(conn, %{"customer_return_id" => r_uuid, "id" => f_uuid}) do
    actor = conn.assigns.current_user

    with %{} = rma <- CustomerReturns.get_for_company(actor.company_id, r_uuid),
         %{} = file <- CustomerReturns.get_file(rma.id, f_uuid),
         abs_path = Backend.Storage.Local.absolute_path(file.blob_path),
         true <- File.exists?(abs_path) do
      conn
      |> put_resp_content_type(file.mime || "application/octet-stream")
      |> put_resp_header(
        "content-disposition",
        ~s(inline; filename="#{file.filename}")
      )
      |> send_file(200, abs_path)
    else
      _ -> {:error, :not_found}
    end
  end

  def remove_file(conn, %{"customer_return_id" => r_uuid, "id" => f_uuid}) do
    actor = conn.assigns.current_user

    with %{} = rma <- CustomerReturns.get_for_company(actor.company_id, r_uuid),
         %{} = file <- CustomerReturns.get_file(rma.id, f_uuid),
         {:ok, _} <- CustomerReturns.remove_file(actor, file) do
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
      "Unsupported file type (#{mime || "unknown"}). Allowed: PDF, images, Word, plain text."}}
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

  defp build_storage_key(rma, kind, %Plug.Upload{filename: filename}) do
    "customer_return_files/" <>
      rma.uuid <>
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
