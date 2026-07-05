defmodule BackendWeb.CustomerController do
  @moduledoc """
  Customer (sell-side) registry — the buyer mirror of
  `BackendWeb.VendorController`.

  Approval is a dedicated `update_approval` action so admins can
  delegate the 4-eyes gate (`customers.approve`) separately from
  generic edit access (`customers.edit`).

  RBAC:
    * `customers.view`    — index, show, picker, serve_file
    * `customers.create`  — create
    * `customers.edit`    — update + contact rows + contact-events + uploads
    * `customers.approve` — update_approval
    * `customers.delete`  — delete + remove_file
  """

  use BackendWeb, :controller

  alias Backend.{Customers, Storage}
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  @allowed_evidence_mimes ~w(application/pdf image/jpeg image/png image/webp
                             application/msword
                             application/vnd.openxmlformats-officedocument.wordprocessingml.document
                             application/vnd.ms-excel
                             application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
                             text/plain)
  @max_evidence_bytes 20 * 1024 * 1024

  plug RequirePermission, "customers.view"
       when action in [:index, :show, :serve_file]
  plug RequirePermission, "customers.create" when action in [:create]
  plug RequirePermission, "customers.edit"
       when action in [
              :update,
              :update_qualification,
              :upload_file,
              :add_contact,
              :update_contact,
              :remove_contact,
              :log_contact_event,
              :snooze_next_contact,
              :add_approved_item,
              :remove_approved_item
            ]
  plug RequirePermission, "customers.approve" when action in [:update_approval]
  plug RequirePermission, "customers.delete" when action in [:delete, :remove_file]

  action_fallback BackendWeb.FallbackController

  # ----- registry list / get ---------------------------------------

  def index(conn, params) do
    actor = conn.assigns.current_user

    case params["picker"] do
      "true" ->
        items = Customers.list_for_company(actor.company_id)
        json(conn, %{items: Enum.map(items, &Payloads.customer_summary/1)})

      _ ->
        opts = list_opts_from_params(params)
        {items, next_cursor} = Customers.list_page(actor.company_id, opts)

        json(conn, %{
          items: Enum.map(items, &Payloads.customer/1),
          next_cursor: next_cursor
        })
    end
  end

  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Customers.get_for_company(actor.company_id, uuid) do
      nil -> {:error, :not_found}
      customer -> json(conn, %{customer: Payloads.customer(customer)})
    end
  end

  # ----- create / update / delete ----------------------------------

  def create(conn, params) do
    actor = conn.assigns.current_user

    case Customers.create(actor, actor.company_id, Map.drop(params, ["id"])) do
      {:ok, customer} ->
        conn
        |> put_status(:created)
        |> json(%{customer: Payloads.customer(customer)})

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = customer <- Customers.get_for_company(actor.company_id, uuid) do
      case Customers.update(actor, customer, Map.drop(params, ["id"])) do
        {:ok, updated} -> json(conn, %{customer: Payloads.customer(updated)})
        {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def delete(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    with %{} = customer <- Customers.get_for_company(actor.company_id, uuid),
         {:ok, _} <- Customers.delete(actor, customer) do
      send_resp(conn, :no_content, "")
    else
      _ -> {:error, :not_found}
    end
  end

  # ----- approval transition ---------------------------------------

  def update_approval(conn, %{"customer_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = customer <- Customers.get_for_company(actor.company_id, uuid) do
      case Customers.approve_customer(actor, customer, Map.drop(params, ["customer_id"])) do
        {:ok, updated} ->
          json(conn, %{customer: Payloads.customer(updated)})

        {:error, {:onboarding_incomplete, missing}} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{
            error: "onboarding_incomplete",
            detail:
              "Customer can't be approved yet — " <>
                Enum.map_join(missing, "; ", & &1.label),
            missing: missing
          })

        {:error, :same_signer_as_qualifier} ->
          conn
          |> put_status(:conflict)
          |> json(
            Errors.payload(
              "same_signer_as_qualifier",
              "Segregation of duties — the person who collected the onboarding evidence can't also sign it off. Get a different reviewer."
            )
          )

        {:error, :same_signer_as_creator} ->
          conn
          |> put_status(:conflict)
          |> json(
            Errors.payload(
              "same_signer_as_creator",
              "Four-eyes rule — the person who created this customer can't also sign it off. Get a different reviewer."
            )
          )

        {:error, :invalid_status} ->
          unprocessable(
            conn,
            "invalid_status",
            "approval_status must be one of: draft, approved, suspended, rejected."
          )

        {:error, {:reason_required, target}} ->
          unprocessable(
            conn,
            "reason_required",
            "A reason is required when #{target == "suspended" and "suspending" || "rejecting"} a customer — audit defensibility."
          )

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def update_qualification(conn, %{"customer_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = customer <- Customers.get_for_company(actor.company_id, uuid) do
      case Customers.update_qualification(actor, customer, Map.drop(params, ["customer_id"])) do
        {:ok, updated} -> json(conn, %{customer: Payloads.customer(updated)})
        {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  # ----- contact-info rows -----------------------------------------

  def add_contact(conn, %{"customer_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = customer <- Customers.get_for_company(actor.company_id, uuid) do
      case Customers.add_contact(actor, customer, Map.drop(params, ["customer_id"])) do
        {:ok, contact} ->
          conn
          |> put_status(:created)
          |> json(%{contact: Payloads.customer_contact(contact)})

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def update_contact(conn, %{"customer_id" => customer_uuid, "id" => row_uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = customer <- Customers.get_for_company(actor.company_id, customer_uuid),
         %{} = contact <- Customers.get_contact(customer.id, row_uuid),
         {:ok, updated} <-
           Customers.update_contact(actor, contact, Map.drop(params, ["customer_id", "id"])) do
      json(conn, %{contact: Payloads.customer_contact(updated)})
    else
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      _ -> {:error, :not_found}
    end
  end

  def remove_contact(conn, %{"customer_id" => customer_uuid, "id" => row_uuid}) do
    actor = conn.assigns.current_user

    with %{} = customer <- Customers.get_for_company(actor.company_id, customer_uuid),
         %{} = contact <- Customers.get_contact(customer.id, row_uuid),
         {:ok, _} <- Customers.remove_contact(actor, contact) do
      send_resp(conn, :no_content, "")
    else
      _ -> {:error, :not_found}
    end
  end

  # ----- contact-event log -----------------------------------------

  def log_contact_event(conn, %{"customer_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = customer <- Customers.get_for_company(actor.company_id, uuid) do
      case Customers.log_contact_event(actor, customer, Map.drop(params, ["customer_id"])) do
        {:ok, %{event: event, customer: updated}} ->
          conn
          |> put_status(:created)
          |> json(%{
            event: Payloads.customer_contact_event(event),
            customer: Payloads.customer(Customers.get_for_company(actor.company_id, updated.uuid))
          })

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def snooze_next_contact(conn, %{"customer_id" => uuid} = params) do
    actor = conn.assigns.current_user
    days = params["days"] || 1

    with %{} = customer <- Customers.get_for_company(actor.company_id, uuid),
         {:ok, updated} <- Customers.snooze_next_contact(actor, customer, days) do
      json(conn, %{
        customer: Payloads.customer(Customers.get_for_company(actor.company_id, updated.uuid))
      })
    else
      {:error, :invalid_days} ->
        unprocessable(conn, "invalid_days", "Snooze days must be a positive integer.")

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)

      _ ->
        {:error, :not_found}
    end
  end

  # ----- file upload + serve ---------------------------------------

  def upload_file(conn, %{"customer_id" => uuid, "file" => %Plug.Upload{} = upload} = params) do
    actor = conn.assigns.current_user
    kind = params["kind"] || "other"

    with %{} = customer <- Customers.get_for_company(actor.company_id, uuid),
         :ok <- validate_evidence_mime(upload.content_type),
         {:ok, bytes} <- read_upload(upload),
         :ok <- validate_evidence_size(bytes),
         :ok <- Backend.Http.UploadValidation.verify_bytes(bytes, upload.content_type) do
      key = build_storage_key(customer, kind, upload)

      case Storage.put(key, bytes, content_type: upload.content_type) do
        {:ok, blob_path} ->
          attrs = %{
            "kind" => kind,
            "filename" => upload.filename || "upload",
            "mime" => upload.content_type || "application/octet-stream",
            "byte_size" => byte_size(bytes),
            "blob_path" => blob_path
          }

          case Customers.record_file(actor, customer, attrs) do
            {:ok, file} ->
              conn
              |> put_status(:created)
              |> json(%{file: Payloads.customer_file(file, customer)})

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

  # See vendor_controller.serve_file/2 for the safety rationale — same
  # pattern: DB-derived blob_path, root-checked, sniff-verified MIME.
  def serve_file(conn, %{"customer_id" => customer_uuid, "id" => file_uuid}) do
    actor = conn.assigns.current_user

    with %{} = customer <- Customers.get_for_company(actor.company_id, customer_uuid),
         %{} = file <- Customers.get_file(customer.id, file_uuid),
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

  def remove_file(conn, %{"customer_id" => customer_uuid, "id" => file_uuid}) do
    actor = conn.assigns.current_user

    with %{} = customer <- Customers.get_for_company(actor.company_id, customer_uuid),
         %{} = file <- Customers.get_file(customer.id, file_uuid),
         {:ok, _} <- Customers.remove_file(actor, file) do
      send_resp(conn, :no_content, "")
    else
      _ -> {:error, :not_found}
    end
  end

  # ----- approved-items (per-customer sellable-items list) ---------

  def add_approved_item(conn, %{"customer_id" => uuid, "item_id" => raw_item_id} = params) do
    actor = conn.assigns.current_user

    with %{} = customer <- Customers.get_for_company(actor.company_id, uuid),
         {item_id, _} <- Integer.parse(to_string(raw_item_id)),
         {:ok, row} <-
           Customers.add_approved_item(
             actor,
             customer,
             item_id,
             Map.drop(params, ["customer_id", "item_id"])
           ) do
      conn
      |> put_status(:created)
      |> json(%{approved_item: Payloads.customer_approved_item(row)})
    else
      :error -> unprocessable(conn, "bad_item_id", "Invalid item id.")
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      _ -> {:error, :not_found}
    end
  end

  def remove_approved_item(conn, %{"customer_id" => customer_uuid, "id" => row_uuid}) do
    actor = conn.assigns.current_user

    with %{} = customer <- Customers.get_for_company(actor.company_id, customer_uuid),
         %{} = row <- Customers.get_approved_item(customer.id, row_uuid),
         {:ok, _} <- Customers.remove_approved_item(actor, row) do
      send_resp(conn, :no_content, "")
    else
      _ -> {:error, :not_found}
    end
  end

  # ----- helpers ----------------------------------------------------

  defp list_opts_from_params(params) do
    [
      cursor: params["cursor"],
      limit: params["limit"],
      sort: parse_sort(params["sort"]),
      search: params["search"],
      column_filter: params["column_filter"],
      approval_status: params["approval_status"],
      is_active: params["is_active"],
      account_manager_id: params["account_manager_id"]
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

  # File.read on upload.path — Plug.Upload's tmp path is server-owned.
  defp read_upload(%Plug.Upload{path: path}) do
    case File.read(path) do
      {:ok, bytes} -> {:ok, bytes}
      {:error, reason} -> {:error, {:read_failed, reason}}
    end
  end

  defp build_storage_key(customer, kind, %Plug.Upload{filename: filename}) do
    "customer_files/" <>
      customer.uuid <>
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

  defp unprocessable(conn, code, detail) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(Errors.payload(code, detail))
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
