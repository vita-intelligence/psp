defmodule BackendWeb.CommentsController do
  @moduledoc """
  Polymorphic comment thread mounted under each entity.

      GET    /api/vendors/:uuid/comments
      POST   /api/vendors/:uuid/comments
      PATCH  /api/vendors/:uuid/comments/:comment_uuid
      DELETE /api/vendors/:uuid/comments/:comment_uuid

  Same shape under `/api/purchase-orders/:uuid/comments` and
  `/api/stock/lots/:uuid/comments`. The entity_type is inferred from
  the route prefix (set via `assign_entity_type/2` in the router),
  the entity_id is resolved from the URL uuid inside each action.

  Reads borrow the entity's view permission (same convention as the
  audit log); writes borrow the entity's edit permission, encoded in
  `Backend.Comments.@write_perms`.
  """

  use BackendWeb, :controller

  alias Backend.{Comments, Purchasing, Stock, Storage, Vendors}
  alias Backend.Comments.Comment
  alias BackendWeb.{Errors, Payloads}

  action_fallback BackendWeb.FallbackController

  # Attachment constraints — mirrored on the FE composer.
  @max_attachment_bytes 25 * 1024 * 1024

  @allowed_image_mimes ~w(image/jpeg image/jpg image/png image/gif image/webp)
  @allowed_video_mimes ~w(video/mp4 video/webm)
  @allowed_audio_mimes ~w(audio/webm audio/mp4 audio/m4a audio/x-m4a audio/mpeg audio/ogg audio/wav)
  @allowed_document_mimes ~w(
    application/pdf
    application/msword
    application/vnd.openxmlformats-officedocument.wordprocessingml.document
    application/vnd.ms-excel
    application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
    application/vnd.ms-powerpoint
    application/vnd.openxmlformats-officedocument.presentationml.presentation
    text/plain
    text/csv
  )
  @allowed_attachment_mimes @allowed_image_mimes ++
                              @allowed_video_mimes ++
                              @allowed_audio_mimes ++
                              @allowed_document_mimes

  # Permission gates are inline because the read perm varies by
  # entity_type — a single `plug RequirePermission, ...` can't
  # discriminate. `check_view_perm/2` + `check_write_perm/2` do the
  # work per-action using the entity_type the router assigned.

  # ----- index -----------------------------------------------------

  def index(conn, %{"entity_uuid" => entity_uuid} = _params) do
    actor = conn.assigns.current_user
    entity_type = conn.assigns.entity_type

    with :ok <- check_view_perm(actor, entity_type),
         {:ok, entity_id} <- resolve_entity_id(actor, entity_type, entity_uuid) do
      items = Comments.list_for(actor.company_id, entity_type, entity_id)
      json(conn, %{items: Enum.map(items, &Payloads.comment(&1, actor.id))})
    else
      {:error, :forbidden} -> forbidden(conn, entity_type, :read)
      {:error, :not_found} -> {:error, :not_found}
    end
  end

  # ----- create ----------------------------------------------------

  def create(conn, %{"entity_uuid" => entity_uuid} = params) do
    actor = conn.assigns.current_user
    entity_type = conn.assigns.entity_type

    with :ok <- check_view_perm(actor, entity_type),
         :ok <- check_write_perm(actor, entity_type),
         {:ok, entity_id} <- resolve_entity_id(actor, entity_type, entity_uuid),
         {:ok, parent_id} <- resolve_parent_comment_id(actor, params) do
      attrs =
        params
        |> Map.take(["body", "visibility", "mentioned_user_ids"])
        |> Map.put("parent_comment_id", parent_id)

      case Comments.create_comment(actor, entity_type, entity_id, attrs) do
        {:ok, comment} ->
          broadcast_event(entity_type, entity_uuid, "comment:created", %{
            comment: Payloads.comment(comment, nil)
          })

          conn
          |> put_status(:created)
          |> json(%{comment: Payloads.comment(comment, actor.id)})

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)

        {:error, :unknown_entity_type} ->
          unprocessable(conn, "unknown_entity_type",
            "Comments aren't enabled for that entity type."
          )

        {:error, :parent_comment_not_found} ->
          unprocessable(conn, "parent_comment_not_found",
            "The reply target doesn't belong to this thread."
          )
      end
    else
      {:error, :forbidden} -> forbidden(conn, entity_type, :write)
      {:error, :not_found} -> {:error, :not_found}
      {:error, :parent_comment_not_found} ->
        unprocessable(conn, "parent_comment_not_found",
          "The reply target doesn't belong to this thread."
        )
    end
  end

  # Frontend never sees integer PKs — it sends `parent_comment_uuid`.
  # Resolve that here so `Comments.create_comment` can keep working
  # against the integer FK. Legacy `parent_comment_id` still accepted
  # for internal callers / test fixtures.
  defp resolve_parent_comment_id(actor, params) do
    cond do
      is_binary(params["parent_comment_uuid"]) and params["parent_comment_uuid"] != "" ->
        case Comments.get_for_company(actor.company_id, params["parent_comment_uuid"]) do
          %Comment{id: id} -> {:ok, id}
          _ -> {:error, :parent_comment_not_found}
        end

      is_integer(params["parent_comment_id"]) ->
        {:ok, params["parent_comment_id"]}

      is_binary(params["parent_comment_id"]) and params["parent_comment_id"] != "" ->
        case Integer.parse(params["parent_comment_id"]) do
          {parsed, ""} -> {:ok, parsed}
          _ -> {:error, :parent_comment_not_found}
        end

      true ->
        {:ok, nil}
    end
  end

  # ----- update ----------------------------------------------------

  def update(conn, %{"entity_uuid" => entity_uuid, "comment_uuid" => comment_uuid} = params) do
    actor = conn.assigns.current_user
    entity_type = conn.assigns.entity_type

    with :ok <- check_view_perm(actor, entity_type),
         :ok <- check_write_perm(actor, entity_type),
         {:ok, _entity_id} <- resolve_entity_id(actor, entity_type, entity_uuid),
         %Backend.Comments.Comment{} = comment <-
           Comments.get_for_company(actor.company_id, comment_uuid),
         :ok <- check_entity_match(comment, entity_type) do
      case Comments.update_comment(actor, comment, Map.take(params, ["body", "visibility"])) do
        {:ok, updated} ->
          broadcast_event(entity_type, entity_uuid, "comment:updated", %{
            comment: Payloads.comment(updated, nil)
          })

          json(conn, %{comment: Payloads.comment(updated, actor.id)})

        {:error, :forbidden} ->
          forbidden_comment_edit(conn)

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      {:error, :forbidden} -> forbidden(conn, entity_type, :write)
      {:error, :not_found} -> {:error, :not_found}
      {:error, :mismatched_entity} -> {:error, :not_found}
      nil -> {:error, :not_found}
    end
  end

  # ----- delete ----------------------------------------------------

  def delete(conn, %{"entity_uuid" => entity_uuid, "comment_uuid" => comment_uuid}) do
    actor = conn.assigns.current_user
    entity_type = conn.assigns.entity_type

    with :ok <- check_view_perm(actor, entity_type),
         :ok <- check_write_perm(actor, entity_type),
         {:ok, _entity_id} <- resolve_entity_id(actor, entity_type, entity_uuid),
         %Backend.Comments.Comment{} = comment <-
           Comments.get_for_company(actor.company_id, comment_uuid),
         :ok <- check_entity_match(comment, entity_type) do
      case Comments.delete_comment(actor, comment) do
        {:ok, updated} ->
          broadcast_event(entity_type, entity_uuid, "comment:deleted", %{
            comment: Payloads.comment(updated, nil)
          })

          json(conn, %{comment: Payloads.comment(updated, actor.id)})

        {:error, :forbidden} ->
          forbidden_comment_delete(conn)
      end
    else
      {:error, :forbidden} -> forbidden(conn, entity_type, :write)
      {:error, :not_found} -> {:error, :not_found}
      {:error, :mismatched_entity} -> {:error, :not_found}
      nil -> {:error, :not_found}
    end
  end

  # ----- attachments -----------------------------------------------

  def upload_file(
        conn,
        %{
          "entity_uuid" => entity_uuid,
          "comment_uuid" => comment_uuid,
          "file" => %Plug.Upload{} = upload
        } = params
      ) do
    actor = conn.assigns.current_user
    entity_type = conn.assigns.entity_type

    with :ok <- check_view_perm(actor, entity_type),
         :ok <- check_write_perm(actor, entity_type),
         {:ok, _entity_id} <- resolve_entity_id(actor, entity_type, entity_uuid),
         %Comment{} = comment <- Comments.get_for_company(actor.company_id, comment_uuid),
         :ok <- check_entity_match(comment, entity_type),
         kind = classify_kind(params["kind"], upload.content_type),
         :ok <- validate_attachment_mime(upload.content_type),
         {:ok, bytes} <- read_upload(upload),
         :ok <- validate_attachment_size(bytes) do
      file_uuid = Ecto.UUID.generate()
      key = build_storage_key(comment, kind, upload, file_uuid)

      case Storage.put(key, bytes, content_type: upload.content_type) do
        {:ok, blob_path} ->
          attrs = %{
            "uuid" => file_uuid,
            "kind" => kind,
            "filename" => upload.filename || "upload",
            "mime" => upload.content_type || "application/octet-stream",
            "byte_size" => byte_size(bytes),
            "blob_path" => blob_path,
            "width_px" => parse_int(params["width_px"]),
            "height_px" => parse_int(params["height_px"]),
            "duration_ms" => parse_int(params["duration_ms"]),
            "waveform" => params["waveform"]
          }

          case Comments.attach_file(actor, comment, attrs) do
            {:ok, file} ->
              payload = Payloads.comment_file(file)

              broadcast_event(entity_type, entity_uuid, "file:attached", %{
                comment_uuid: comment.uuid,
                file: payload
              })

              conn
              |> put_status(:created)
              |> json(%{file: payload})

            {:error, :forbidden} ->
              forbidden_file_write(conn)

            {:error, :file_limit_reached} ->
              unprocessable(conn, "attachment_limit_reached",
                "This comment already has the maximum #{Comments.max_files_per_comment()} attachments.")

            {:error, %Ecto.Changeset{} = cs} ->
              # The bytes are already on disk — clean up so we don't
              # leak orphans on a validation bounce.
              _ = Storage.delete(blob_path)
              changeset_error(conn, cs)
          end

        {:error, reason} ->
          unprocessable(conn, "storage_failed",
            "Couldn't store the file (#{inspect(reason)}).")
      end
    else
      {:error, :forbidden} -> forbidden(conn, entity_type, :write)
      {:error, :not_found} -> {:error, :not_found}
      {:error, :mismatched_entity} -> {:error, :not_found}
      {:error, {:invalid_mime, detail}} -> unprocessable(conn, "invalid_mime_type", detail)
      {:error, {:too_large, bytes}} -> file_too_large(conn, bytes)
      {:error, {:read_failed, reason}} ->
        unprocessable(conn, "read_failed", "Couldn't read the upload: #{inspect(reason)}.")

      nil -> {:error, :not_found}
    end
  end

  def upload_file(conn, _params) do
    unprocessable(conn, "missing_file", "Send the file under `file` (multipart).")
  end

  def delete_file(conn, %{
        "entity_uuid" => entity_uuid,
        "comment_uuid" => comment_uuid,
        "file_uuid" => file_uuid
      }) do
    actor = conn.assigns.current_user
    entity_type = conn.assigns.entity_type

    with :ok <- check_view_perm(actor, entity_type),
         :ok <- check_write_perm(actor, entity_type),
         {:ok, _entity_id} <- resolve_entity_id(actor, entity_type, entity_uuid),
         %Comment{} = comment <- Comments.get_for_company(actor.company_id, comment_uuid),
         :ok <- check_entity_match(comment, entity_type),
         %Backend.Comments.CommentFile{} = file <- Comments.get_file(comment.id, file_uuid) do
      case Comments.delete_file(actor, file) do
        {:ok, _} ->
          broadcast_event(entity_type, entity_uuid, "file:removed", %{
            comment_uuid: comment.uuid,
            file_uuid: file.uuid
          })

          conn |> put_status(:ok) |> json(%{ok: true})

        {:error, :forbidden} ->
          forbidden_file_delete(conn)

        {:error, :not_found} ->
          {:error, :not_found}
      end
    else
      {:error, :forbidden} -> forbidden(conn, entity_type, :write)
      {:error, :not_found} -> {:error, :not_found}
      {:error, :mismatched_entity} -> {:error, :not_found}
      nil -> {:error, :not_found}
    end
  end

  @doc """
  Entity-agnostic serve — used by URLs stamped into `CommentFile.url`
  by `Backend.Storage.public_url/1`. The stored blob path only carries
  the comment_uuid (not the parent entity's uuid), so we can't
  reconstruct the scoped URL; instead the endpoint looks up the file,
  loads the parent comment, and re-checks the comment's entity view
  perm on the fly. Tenanted by company on the file itself.
  """
  def serve_file_bare(conn, %{"file_uuid" => file_uuid}) do
    actor = conn.assigns.current_user

    with %Backend.Comments.CommentFile{} = file <-
           Comments.get_file_for_company(actor.company_id, file_uuid),
         :ok <- check_view_perm(actor, file.comment.entity_type),
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

  def serve_file(conn, %{
        "entity_uuid" => entity_uuid,
        "comment_uuid" => comment_uuid,
        "file_uuid" => file_uuid
      }) do
    actor = conn.assigns.current_user
    entity_type = conn.assigns.entity_type

    with :ok <- check_view_perm(actor, entity_type),
         {:ok, _entity_id} <- resolve_entity_id(actor, entity_type, entity_uuid),
         %Comment{} = comment <- Comments.get_for_company(actor.company_id, comment_uuid),
         :ok <- check_entity_match(comment, entity_type),
         %Backend.Comments.CommentFile{} = file <- Comments.get_file(comment.id, file_uuid),
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

  # ----- reactions -------------------------------------------------

  def add_reaction(conn, %{
        "entity_uuid" => entity_uuid,
        "comment_uuid" => comment_uuid,
        "emoji" => emoji
      })
      when is_binary(emoji) do
    actor = conn.assigns.current_user
    entity_type = conn.assigns.entity_type

    with :ok <- check_view_perm(actor, entity_type),
         :ok <- check_write_perm(actor, entity_type),
         {:ok, _entity_id} <- resolve_entity_id(actor, entity_type, entity_uuid),
         %Comment{} = comment <- Comments.get_for_company(actor.company_id, comment_uuid),
         :ok <- check_entity_match(comment, entity_type) do
      case Comments.add_reaction(actor, comment, emoji) do
        {:ok, reaction} ->
          broadcast_event(entity_type, entity_uuid, "reaction:added", %{
            comment_uuid: comment.uuid,
            emoji: reaction.emoji,
            user_id: actor.id
          })

          json(conn, %{ok: true, emoji: reaction.emoji})

        {:error, :forbidden} ->
          forbidden(conn, entity_type, :write)

        {:error, :reaction_limit_reached} ->
          unprocessable(conn, "reaction_limit_reached",
            "This comment already has the maximum #{Comments.max_reactions_per_comment()} reactions.")

        {:error, :invalid_emoji} ->
          unprocessable(conn, "invalid_emoji", "Emoji is required.")

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      {:error, :forbidden} -> forbidden(conn, entity_type, :write)
      {:error, :not_found} -> {:error, :not_found}
      {:error, :mismatched_entity} -> {:error, :not_found}
      nil -> {:error, :not_found}
    end
  end

  def add_reaction(conn, _params) do
    unprocessable(conn, "missing_emoji", "Send an emoji in the request body under `emoji`.")
  end

  def remove_reaction(conn, %{
        "entity_uuid" => entity_uuid,
        "comment_uuid" => comment_uuid
      } = params) do
    actor = conn.assigns.current_user
    entity_type = conn.assigns.entity_type
    emoji = params["emoji"]

    with true <- is_binary(emoji) and emoji != "",
         :ok <- check_view_perm(actor, entity_type),
         :ok <- check_write_perm(actor, entity_type),
         {:ok, _entity_id} <- resolve_entity_id(actor, entity_type, entity_uuid),
         %Comment{} = comment <- Comments.get_for_company(actor.company_id, comment_uuid),
         :ok <- check_entity_match(comment, entity_type) do
      case Comments.remove_reaction(actor, comment, emoji) do
        {:ok, _} ->
          broadcast_event(entity_type, entity_uuid, "reaction:removed", %{
            comment_uuid: comment.uuid,
            emoji: String.trim(emoji),
            user_id: actor.id
          })

          json(conn, %{ok: true})

        {:error, :invalid_emoji} ->
          unprocessable(conn, "invalid_emoji", "Emoji is required.")
      end
    else
      false -> unprocessable(conn, "missing_emoji", "Include `emoji` in the query string.")
      {:error, :forbidden} -> forbidden(conn, entity_type, :write)
      {:error, :not_found} -> {:error, :not_found}
      {:error, :mismatched_entity} -> {:error, :not_found}
      nil -> {:error, :not_found}
    end
  end

  # The comment's polymorphic edge must agree with the URL prefix —
  # otherwise someone could PATCH a vendor comment via the PO route
  # and skip the matching permission check. Defensive only; the FE
  # never builds these URLs.
  defp check_entity_match(%Backend.Comments.Comment{entity_type: t}, t), do: :ok
  defp check_entity_match(_, _), do: {:error, :mismatched_entity}

  # ----- helpers ---------------------------------------------------

  # Resolve the URL uuid → the row's integer id, scoped to the actor's
  # company. Returns `{:error, :not_found}` for cross-tenant uuids or
  # bad uuids.
  defp resolve_entity_id(actor, "vendor", uuid) do
    case Vendors.get_for_company(actor.company_id, uuid) do
      %{id: id} -> {:ok, id}
      _ -> {:error, :not_found}
    end
  end

  defp resolve_entity_id(actor, "customer", uuid) do
    case Backend.Customers.get_for_company(actor.company_id, uuid) do
      %{id: id} -> {:ok, id}
      _ -> {:error, :not_found}
    end
  end

  defp resolve_entity_id(actor, "pricelist", uuid) do
    case Backend.Pricelists.get_for_company(actor.company_id, uuid) do
      %{id: id} -> {:ok, id}
      _ -> {:error, :not_found}
    end
  end

  defp resolve_entity_id(actor, "customer_order", uuid) do
    case Backend.CustomerOrders.get_for_company(actor.company_id, uuid) do
      %{id: id} -> {:ok, id}
      _ -> {:error, :not_found}
    end
  end

  defp resolve_entity_id(actor, "customer_invoice", uuid) do
    case Backend.CustomerInvoices.get_for_company(actor.company_id, uuid) do
      %{id: id} -> {:ok, id}
      _ -> {:error, :not_found}
    end
  end

  defp resolve_entity_id(actor, "customer_return", uuid) do
    case Backend.CustomerReturns.get_for_company(actor.company_id, uuid) do
      %{id: id} -> {:ok, id}
      _ -> {:error, :not_found}
    end
  end

  defp resolve_entity_id(actor, "loyalty_program", uuid) do
    case Backend.Loyalty.get_program(actor.company_id, uuid) do
      %{id: id} -> {:ok, id}
      _ -> {:error, :not_found}
    end
  end

  defp resolve_entity_id(actor, "purchase_order", uuid) do
    case Purchasing.get_for_company(actor.company_id, uuid) do
      %{id: id} -> {:ok, id}
      _ -> {:error, :not_found}
    end
  end

  defp resolve_entity_id(actor, "stock_lot", uuid) do
    case Stock.get_for_company(actor.company_id, uuid) do
      %{id: id} -> {:ok, id}
      _ -> {:error, :not_found}
    end
  end

  defp resolve_entity_id(actor, "bom", uuid) do
    case Backend.Production.get(actor.company_id, uuid) do
      %{id: id} -> {:ok, id}
      _ -> {:error, :not_found}
    end
  end

  defp resolve_entity_id(actor, "workstation_group", uuid) do
    case Backend.Production.get_workstation_group(actor.company_id, uuid) do
      %{id: id} -> {:ok, id}
      _ -> {:error, :not_found}
    end
  end

  defp resolve_entity_id(actor, "workstation", uuid) do
    case Backend.Production.get_workstation(actor.company_id, uuid) do
      %{id: id} -> {:ok, id}
      _ -> {:error, :not_found}
    end
  end

  defp resolve_entity_id(actor, "routing", uuid) do
    case Backend.Production.get_routing(actor.company_id, uuid) do
      %{id: id} -> {:ok, id}
      _ -> {:error, :not_found}
    end
  end

  defp resolve_entity_id(actor, "manufacturing_order", uuid) do
    case Backend.Production.get_manufacturing_order(actor.company_id, uuid) do
      %{id: id} -> {:ok, id}
      _ -> {:error, :not_found}
    end
  end

  defp resolve_entity_id(actor, "manufacturing_order_step", uuid) do
    case Backend.Production.get_mo_step(actor.company_id, uuid) do
      %{id: id} -> {:ok, id}
      _ -> {:error, :not_found}
    end
  end

  defp resolve_entity_id(actor, "shipment", uuid) do
    case Backend.Shipments.get_shipment(actor.company_id, uuid) do
      %{id: id} -> {:ok, id}
      _ -> {:error, :not_found}
    end
  end

  defp resolve_entity_id(actor, "purchase_order_line", uuid) do
    # PO-line uuid is globally unique. Walk to the parent PO to
    # enforce the company scope — a stray uuid from another tenant
    # shouldn't leak a resolution.
    import Ecto.Query

    case Backend.Repo.one(
           from l in Backend.Purchasing.PurchaseOrderLine,
             join: po in assoc(l, :purchase_order),
             where: l.uuid == ^uuid and po.company_id == ^actor.company_id,
             select: l.id,
             limit: 1
         ) do
      id when is_integer(id) -> {:ok, id}
      _ -> {:error, :not_found}
    end
  end

  defp resolve_entity_id(_actor, _other, _uuid), do: {:error, :not_found}

  defp view_perm_for("vendor"), do: "vendors.view"
  defp view_perm_for("customer"), do: "customers.view"
  defp view_perm_for("pricelist"), do: "pricelists.view"
  defp view_perm_for("customer_order"), do: "customer_orders.view"
  defp view_perm_for("customer_invoice"), do: "customer_invoices.view"
  defp view_perm_for("customer_return"), do: "customer_returns.view"
  defp view_perm_for("loyalty_program"), do: "loyalty.view"
  defp view_perm_for("purchase_order"), do: "procurement.po_view"
  defp view_perm_for("stock_lot"), do: "stock.view"
  defp view_perm_for("bom"), do: "production.bom_view"
  defp view_perm_for("workstation_group"), do: "production.workstation_group_view"
  defp view_perm_for("workstation"), do: "production.workstation_view"
  defp view_perm_for("routing"), do: "production.routing_view"
  defp view_perm_for("manufacturing_order"), do: "production.mo_view"
  defp view_perm_for("manufacturing_order_step"), do: "production.mo_view"
  defp view_perm_for("shipment"), do: "shipments.view"
  defp view_perm_for("purchase_order_line"), do: "procurement.po_view"
  defp view_perm_for(_), do: nil

  defp check_view_perm(actor, entity_type) do
    case view_perm_for(entity_type) do
      nil -> {:error, :not_found}
      code -> if Backend.RBAC.has_permission?(actor, code), do: :ok, else: {:error, :forbidden}
    end
  end

  defp check_write_perm(actor, entity_type) do
    if Comments.can_comment_on?(actor, entity_type), do: :ok, else: {:error, :forbidden}
  end

  # Broadcast a comment event to the entity's discussion channel so
  # every other open thread sees the new row live. We endpoint-broadcast
  # because the controller isn't inside a channel process — using
  # `Endpoint.broadcast/3` keeps the call site simple.
  defp broadcast_event(entity_type, entity_uuid, event, payload) do
    topic = "comments:#{entity_type}:#{entity_uuid}"
    BackendWeb.Endpoint.broadcast(topic, event, payload)
  end

  defp forbidden(conn, entity_type, mode) do
    {label, codes} =
      case mode do
        :read ->
          {"view " <> entity_type <> " comments", [view_perm_for(entity_type)]}

        :write ->
          {"comment on " <> entity_type, Comments.write_permissions_for(entity_type)}
      end

    codes = Enum.reject(codes || [], &is_nil/1)
    code_phrase = Enum.map_join(codes, " OR ", &"`#{&1}`")

    detail =
      if code_phrase == "",
        do: "You don't have permission to #{label}.",
        else: "You need the #{code_phrase} permission to #{label}."

    conn
    |> put_status(:forbidden)
    |> json(Errors.payload("missing_permission", detail))
  end

  defp forbidden_comment_edit(conn) do
    conn
    |> put_status(:forbidden)
    |> json(
      Errors.payload(
        "comment_edit_forbidden",
        "Only the original author can edit a comment."
      )
    )
  end

  defp forbidden_comment_delete(conn) do
    conn
    |> put_status(:forbidden)
    |> json(
      Errors.payload(
        "comment_delete_forbidden",
        "Only the original author or an admin can delete a comment."
      )
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

  # ----- attachment helpers ----------------------------------------

  defp forbidden_file_write(conn) do
    conn
    |> put_status(:forbidden)
    |> json(
      Errors.payload(
        "comment_file_write_forbidden",
        "You need edit permission on this entity to attach files to comments."
      )
    )
  end

  defp forbidden_file_delete(conn) do
    conn
    |> put_status(:forbidden)
    |> json(
      Errors.payload(
        "comment_file_delete_forbidden",
        "Only the comment author or an admin can remove an attachment."
      )
    )
  end

  defp classify_kind(kind, _mime) when kind in ~w(image video audio gif file), do: kind

  defp classify_kind(_kind, mime) when is_binary(mime) do
    cond do
      mime == "image/gif" -> "gif"
      mime in @allowed_image_mimes -> "image"
      mime in @allowed_video_mimes -> "video"
      mime in @allowed_audio_mimes -> "audio"
      true -> "file"
    end
  end

  defp classify_kind(_, _), do: "file"

  defp validate_attachment_mime(mime) when mime in @allowed_attachment_mimes, do: :ok

  defp validate_attachment_mime(mime) do
    {:error,
     {:invalid_mime,
      "Unsupported file type (#{mime || "unknown"}). Allowed: images, videos, voice notes, PDFs, and common office formats."}}
  end

  defp validate_attachment_size(bytes) when byte_size(bytes) > @max_attachment_bytes do
    {:error, {:too_large, byte_size(bytes)}}
  end

  defp validate_attachment_size(_), do: :ok

  defp read_upload(%Plug.Upload{path: path}) do
    case File.read(path) do
      {:ok, bytes} -> {:ok, bytes}
      {:error, reason} -> {:error, {:read_failed, reason}}
    end
  end

  defp build_storage_key(
         %Comment{} = comment,
         kind,
         %Plug.Upload{filename: filename},
         file_uuid
       ) do
    # File uuid IS the storage-key token — `Backend.Storage.Local.public_url/2`
    # parses this exact shape to build the serve URL, so the two must
    # stay in lockstep. Do not rearrange without updating the adapter.
    "comment_files/" <>
      comment.uuid <>
      "/" <>
      kind <>
      "_" <>
      file_uuid <>
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
    max_mb = Float.round(@max_attachment_bytes / 1024 / 1024, 1)

    unprocessable(conn, "file_too_large",
      "File is #{mb} MB; max allowed is #{max_mb} MB.")
  end

  defp parse_int(nil), do: nil
  defp parse_int(n) when is_integer(n), do: n

  defp parse_int(n) when is_binary(n) do
    case Integer.parse(n) do
      {parsed, ""} -> parsed
      _ -> nil
    end
  end

  defp parse_int(_), do: nil
end
