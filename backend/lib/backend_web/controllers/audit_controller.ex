defmodule BackendWeb.AuditController do
  @moduledoc """
  Read-only history log for any audited entity.

      GET /api/audit?entity_type=warehouse&entity_id=42

  Permission is borrowed from the entity's own view permission — so
  anyone allowed to see the warehouse can read its history. This
  keeps the matrix flat (no separate `audit.view` to manage) and
  matches the "if you can see it, you can see how it got that way"
  intuition.
  """

  use BackendWeb, :controller

  alias Backend.{Audit, Accounts, RBAC, Warehouses}
  alias BackendWeb.Errors

  action_fallback BackendWeb.FallbackController

  @entity_view_perms %{
    # `warehouse` is kind-dependent — the same table powers warehouses
    # (`warehouses.view`) and production facilities
    # (`production.facility_view`). The atom sentinel tells
    # `check_view_perm/2` to defer to `check_entity_in_company/3`
    # where we've loaded the row and can read its kind.
    "warehouse" => :kind_dependent,
    "user" => "users.view",
    "template" => "roles.view",
    # Floor + storage location + storage cell histories ride the
    # same permission as the parent warehouse — if you can see the
    # warehouse, you can see how its plan got to its current state.
    "floor" => "warehouses.view",
    "storage_location" => "warehouses.view",
    "storage_cell" => "warehouses.view",
    "storage_tag" => "warehouses.view",
    "unit_of_measurement" => "units.view",
    "item" => "items.view",
    "product_family" => "items.view",
    "attribute_definition" => "items.view",
    # Sub-table audit borrows the parent's view perm. Risk
    # assessment uses its own perm because not everyone with item
    # read should see risk scores.
    "raw_material_compliance" => "items.view",
    "raw_material_risk_assessment" => "risk_assessments.view",
    "finished_product_spec" => "items.view",
    "packaging_compliance" => "items.view",
    "certificate" => "certificates.view",
    "item_certificate" => "items.view",
    "item_image" => "items.view",
    # Stock domain. All three entities (lot, placement, movement)
    # ride the same view perm — operators with stock.view can read
    # the whole audit trail of a lot they can already see.
    "stock_lot" => "stock.view",
    "stock_lot_placement" => "stock.view",
    "stock_movement" => "stock.view",
    # Vendor domain — the approved-supplier registry + per-item +
    # certificate edges all ride the same view perm.
    "vendor" => "vendors.view",
    "vendor_approved_item" => "vendors.view",
    "vendor_certificate" => "vendors.view",
    # Procurement domain.
    "purchase_order" => "procurement.po_view",
    "purchase_order_line" => "procurement.po_view",
    "purchase_order_approval" => "procurement.po_view",
    # Production domain.
    "bom" => "production.bom_view",
    "workstation_group" => "production.workstation_group_view",
    "workstation" => "production.workstation_view",
    "routing" => "production.routing_view",
    "manufacturing_order" => "production.mo_view",
    "manufacturing_order_step" => "production.mo_view"
  }

  def index(conn, %{"entity_type" => entity_type, "entity_id" => entity_id_str} = params) do
    actor = conn.assigns.current_user

    with :ok <- check_view_perm(actor, entity_type),
         {entity_id, ""} <- Integer.parse(to_string(entity_id_str)),
         :ok <- check_entity_in_company(actor, entity_type, entity_id) do
      {items, next_cursor} =
        Audit.list_for_entity(actor.company_id, entity_type, entity_id,
          cursor: params["cursor"],
          limit: params["limit"]
        )

      json(conn, %{
        items: Enum.map(items, &payload/1),
        next_cursor: next_cursor
      })
    else
      # `entity_id` didn't parse as an integer. The client typed
      # something nonsensical into the query string.
      :error ->
        send_error(conn, :bad_request, "invalid_entity_id",
          "entity_id query param must be an integer.")

      # The entity_type isn't in `@entity_view_perms`. Likely a missed
      # wiring step when adding a new audited entity — surface the
      # actual type so the dev can spot it in prod logs.
      {:error, :unknown_entity} ->
        send_error(conn, :not_found, "unknown_entity_type",
          "Activity isn't wired for entity_type=#{inspect(entity_type)}. " <>
          "Check AuditController.@entity_view_perms.")

      # Row exists in another company, or doesn't exist at all. We
      # collapse the two for security (don't leak "this id exists in
      # another tenant"), but still tell the user something useful.
      {:error, :cross_company} ->
        send_error(conn, :not_found, "entity_not_found",
          "No #{entity_type} with id=#{entity_id_str} is visible to your company.")

      # User is logged in but lacks the view permission for this
      # entity type. Include the required code so admins can grant it
      # (or a hint for the kind-dependent warehouse case).
      {:error, :forbidden} ->
        required =
          case Map.get(@entity_view_perms, entity_type) do
            :kind_dependent ->
              "warehouses.view or production.facility_view"

            other ->
              other
          end

        send_error(conn, :forbidden, "missing_permission",
          "You need the `#{required}` permission to view #{entity_type} activity.")
    end
  end

  def index(conn, _params) do
    send_error(conn, :bad_request, "missing_params",
      "GET /api/audit requires entity_type and entity_id query params.")
  end

  defp send_error(conn, status, code, detail) do
    conn
    |> put_status(status)
    |> json(Errors.payload(code, detail))
  end

  ## ------------------------------------------------------------------

  defp check_view_perm(actor, entity_type) do
    case Map.fetch(@entity_view_perms, entity_type) do
      # "warehouse" is special: the same table backs both warehouse-
      # and production-facility-kind rows. The kind-specific perm
      # check happens in `check_entity_in_company/3` once we've
      # loaded the row and can read its kind.
      {:ok, :kind_dependent} ->
        :ok

      {:ok, code} ->
        if RBAC.has_permission?(actor, code), do: :ok, else: {:error, :forbidden}

      :error ->
        {:error, :unknown_entity}
    end
  end

  defp check_entity_in_company(actor, "warehouse", entity_id) do
    case Backend.Repo.get(Warehouses.Warehouse, entity_id) do
      %{company_id: company_id, kind: kind} when company_id == actor.company_id ->
        code =
          case kind do
            "production_facility" -> "production.facility_view"
            _ -> "warehouses.view"
          end

        if RBAC.has_permission?(actor, code),
          do: :ok,
          else: {:error, :forbidden}

      _ ->
        {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "user", entity_id) do
    case Accounts.get_user(entity_id) do
      %{company_id: company_id} when company_id == actor.company_id -> :ok
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "template", entity_id) do
    case Backend.Repo.get(Backend.RBAC.Role, entity_id) do
      %{company_id: company_id} when company_id == actor.company_id -> :ok
      _ -> {:error, :cross_company}
    end
  end

  # Floors + storage locations carry warehouse_id directly so the
  # cross-company check just looks at the parent warehouse's company.
  defp check_entity_in_company(actor, "floor", entity_id) do
    check_via_warehouse_id(actor, Backend.Warehouses.Floor, entity_id)
  end

  defp check_entity_in_company(actor, "storage_location", entity_id) do
    check_via_warehouse_id(actor, Backend.Warehouses.StorageLocation, entity_id)
  end

  # Cells don't carry warehouse_id directly — hop through their
  # storage_location to find the parent warehouse.
  defp check_entity_in_company(actor, "storage_tag", entity_id) do
    case Backend.Repo.get(Backend.Warehouses.StorageTag, entity_id) do
      %{company_id: company_id} when company_id == actor.company_id -> :ok
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "unit_of_measurement", entity_id) do
    case Backend.Repo.get(Backend.Units.UnitOfMeasurement, entity_id) do
      %{company_id: company_id} when company_id == actor.company_id -> :ok
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "item", entity_id) do
    case Backend.Repo.get(Backend.Items.Item, entity_id) do
      %{company_id: company_id} when company_id == actor.company_id -> :ok
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "product_family", entity_id) do
    case Backend.Repo.get(Backend.Catalogs.ProductFamily, entity_id) do
      %{company_id: company_id} when company_id == actor.company_id -> :ok
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "attribute_definition", entity_id) do
    case Backend.Repo.get(Backend.Catalogs.AttributeDefinition, entity_id) do
      %{company_id: company_id} when company_id == actor.company_id -> :ok
      _ -> {:error, :cross_company}
    end
  end

  # Sub-table audit rows reference the item id directly (1:1 keying).
  # Check the parent item's company.
  defp check_entity_in_company(actor, "raw_material_compliance", entity_id) do
    check_parent_item(actor, entity_id)
  end

  defp check_entity_in_company(actor, "raw_material_risk_assessment", entity_id) do
    check_parent_item(actor, entity_id)
  end

  defp check_entity_in_company(actor, "finished_product_spec", entity_id) do
    check_parent_item(actor, entity_id)
  end

  defp check_entity_in_company(actor, "packaging_compliance", entity_id) do
    check_parent_item(actor, entity_id)
  end

  defp check_entity_in_company(actor, "certificate", entity_id) do
    case Backend.Repo.get(Backend.Certificates.Certificate, entity_id) do
      %{company_id: company_id} when company_id == actor.company_id -> :ok
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "item_certificate", entity_id) do
    case Backend.Repo.get(Backend.Certificates.ItemCertificate, entity_id) do
      %{item_id: item_id} -> check_parent_item(actor, item_id)
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "item_image", entity_id) do
    case Backend.Repo.get(Backend.Items.ItemImage, entity_id) do
      %{item_id: item_id} -> check_parent_item(actor, item_id)
      _ -> {:error, :cross_company}
    end
  end

  defp check_parent_item(actor, item_id) do
    case Backend.Repo.get(Backend.Items.Item, item_id) do
      %{company_id: company_id} when company_id == actor.company_id -> :ok
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "storage_cell", entity_id) do
    case Backend.Repo.get(Backend.Warehouses.StorageCell, entity_id) do
      %{storage_location_id: location_id} ->
        check_via_warehouse_id(
          actor,
          Backend.Warehouses.StorageLocation,
          location_id
        )

      _ ->
        {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "stock_lot", entity_id) do
    case Backend.Repo.get(Backend.Stock.Lot, entity_id) do
      %{company_id: company_id} when company_id == actor.company_id -> :ok
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "stock_lot_placement", entity_id) do
    case Backend.Repo.get(Backend.Stock.Placement, entity_id) do
      %{stock_lot_id: lot_id} -> check_parent_stock_lot(actor, lot_id)
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "stock_movement", entity_id) do
    case Backend.Repo.get(Backend.Stock.Movement, entity_id) do
      %{stock_lot_id: lot_id} -> check_parent_stock_lot(actor, lot_id)
      _ -> {:error, :cross_company}
    end
  end

  defp check_parent_stock_lot(actor, lot_id) do
    case Backend.Repo.get(Backend.Stock.Lot, lot_id) do
      %{company_id: company_id} when company_id == actor.company_id -> :ok
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "vendor", entity_id) do
    case Backend.Repo.get(Backend.Vendors.Vendor, entity_id) do
      %{company_id: company_id} when company_id == actor.company_id -> :ok
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "vendor_approved_item", entity_id) do
    case Backend.Repo.get(Backend.Vendors.ApprovedItem, entity_id) do
      %{vendor_id: vid} -> check_parent_vendor(actor, vid)
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "vendor_certificate", entity_id) do
    case Backend.Repo.get(Backend.Vendors.VendorCertificate, entity_id) do
      %{vendor_id: vid} -> check_parent_vendor(actor, vid)
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "purchase_order", entity_id) do
    case Backend.Repo.get(Backend.Purchasing.PurchaseOrder, entity_id) do
      %{company_id: company_id} when company_id == actor.company_id -> :ok
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "purchase_order_line", entity_id) do
    case Backend.Repo.get(Backend.Purchasing.PurchaseOrderLine, entity_id) do
      %{purchase_order_id: poid} -> check_parent_purchase_order(actor, poid)
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "purchase_order_approval", entity_id) do
    case Backend.Repo.get(Backend.Purchasing.PurchaseOrderApproval, entity_id) do
      %{purchase_order_id: poid} -> check_parent_purchase_order(actor, poid)
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "bom", entity_id) do
    case Backend.Repo.get(Backend.Production.BOM, entity_id) do
      %{company_id: company_id} when company_id == actor.company_id -> :ok
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "workstation_group", entity_id) do
    case Backend.Repo.get(Backend.Production.WorkstationGroup, entity_id) do
      %{company_id: company_id} when company_id == actor.company_id -> :ok
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "workstation", entity_id) do
    case Backend.Repo.get(Backend.Production.Workstation, entity_id) do
      %{company_id: company_id} when company_id == actor.company_id -> :ok
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "routing", entity_id) do
    case Backend.Repo.get(Backend.Production.Routing, entity_id) do
      %{company_id: company_id} when company_id == actor.company_id -> :ok
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "manufacturing_order", entity_id) do
    case Backend.Repo.get(Backend.Production.ManufacturingOrder, entity_id) do
      %{company_id: company_id} when company_id == actor.company_id -> :ok
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "manufacturing_order_step", entity_id) do
    case Backend.Repo.get(Backend.Production.ManufacturingOrderStep, entity_id) do
      %{company_id: company_id} when company_id == actor.company_id -> :ok
      _ -> {:error, :cross_company}
    end
  end

  defp check_parent_vendor(actor, vid) do
    case Backend.Repo.get(Backend.Vendors.Vendor, vid) do
      %{company_id: company_id} when company_id == actor.company_id -> :ok
      _ -> {:error, :cross_company}
    end
  end

  defp check_parent_purchase_order(actor, poid) do
    case Backend.Repo.get(Backend.Purchasing.PurchaseOrder, poid) do
      %{company_id: company_id} when company_id == actor.company_id -> :ok
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(_actor, _, _), do: {:error, :unknown_entity}

  defp check_via_warehouse_id(actor, schema, entity_id) do
    case Backend.Repo.get(schema, entity_id) do
      %{warehouse_id: warehouse_id} ->
        case Backend.Repo.get(Backend.Warehouses.Warehouse, warehouse_id) do
          %{company_id: company_id} when company_id == actor.company_id -> :ok
          _ -> {:error, :cross_company}
        end

      _ ->
        {:error, :cross_company}
    end
  end

  defp payload(event) do
    %{
      id: event.id,
      entity_type: event.entity_type,
      entity_id: event.entity_id,
      entity_uuid: event.entity_uuid,
      event: event.event,
      changes: event.changes,
      state_after: event.state_after,
      at: event.at,
      actor: actor_payload(event)
    }
  end

  # Prefer the snapshot embedded at event time so a later rename /
  # deactivation doesn't rewrite history. Fall back to the live actor
  # row when the snapshot is absent (older rows).
  defp actor_payload(%{actor_snapshot: snap}) when map_size(snap) > 0 do
    %{
      id: snap["id"],
      name: snap["name"],
      email: snap["email"],
      avatar: snap["avatar"]
    }
  end

  defp actor_payload(%{actor: %Backend.Accounts.User{} = u}) do
    %{id: u.id, name: u.name, email: u.email, avatar: u.avatar}
  end

  defp actor_payload(_), do: nil
end
