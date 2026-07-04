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

  alias Backend.{Comments, Purchasing, Stock, Vendors}
  alias BackendWeb.{Errors, Payloads}

  action_fallback BackendWeb.FallbackController

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
      json(conn, %{items: Enum.map(items, &Payloads.comment/1)})
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
         {:ok, entity_id} <- resolve_entity_id(actor, entity_type, entity_uuid) do
      attrs = params |> Map.take(["body", "visibility", "parent_comment_id", "mentioned_user_ids"])

      case Comments.create_comment(actor, entity_type, entity_id, attrs) do
        {:ok, comment} ->
          broadcast_event(entity_type, entity_uuid, "comment:created", %{
            comment: Payloads.comment(comment)
          })

          conn
          |> put_status(:created)
          |> json(%{comment: Payloads.comment(comment)})

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)

        {:error, :unknown_entity_type} ->
          unprocessable(conn, "unknown_entity_type",
            "Comments aren't enabled for that entity type."
          )
      end
    else
      {:error, :forbidden} -> forbidden(conn, entity_type, :write)
      {:error, :not_found} -> {:error, :not_found}
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
            comment: Payloads.comment(updated)
          })

          json(conn, %{comment: Payloads.comment(updated)})

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
            comment: Payloads.comment(updated)
          })

          json(conn, %{comment: Payloads.comment(updated)})

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
end
