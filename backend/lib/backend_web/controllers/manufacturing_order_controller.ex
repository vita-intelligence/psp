defmodule BackendWeb.ManufacturingOrderController do
  @moduledoc """
  Manufacturing orders CRUD + status transitions.

  Permission gates:
    * `:index`, `:show`        → `production.mo_view`
    * `:create`                → `production.mo_create`
    * `:update`                → `production.mo_edit`
    * `:delete`                → `production.mo_delete`
    * `:transition` to approved   → `production.mo_approve`
    * `:transition` other states  → `production.mo_execute`

  Transitions live on `/api/production/manufacturing-orders/:id/transition`
  with a `{to: "approved" | ...}` body. The context layer enforces
  the allowed state-pair table.
  """

  use BackendWeb, :controller

  alias Backend.Production
  alias Backend.Production.ManufacturingOrder
  alias Backend.RBAC
  alias BackendWeb.Errors
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  action_fallback BackendWeb.FallbackController

  plug RequirePermission, "production.mo_view" when action in [:index, :show]
  plug RequirePermission, "production.mo_create" when action in [:create]
  plug RequirePermission, "production.mo_edit" when action in [:update]
  plug RequirePermission, "production.mo_delete" when action in [:delete]

  def index(conn, params) do
    actor = conn.assigns.current_user

    opts =
      [
        cursor: params["cursor"],
        limit: params["limit"],
        sort: parse_sort(params["sort"]),
        search: params["search"],
        status: params["status"],
        item_id: params["item_id"],
        warehouse_id: params["warehouse_id"]
      ]
      |> Enum.reject(fn {_k, v} -> is_nil(v) end)

    {items, next_cursor} =
      Production.list_manufacturing_orders_page(actor.company_id, opts)

    json(conn, %{
      items: Enum.map(items, &Payloads.manufacturing_order_summary/1),
      next_cursor: next_cursor
    })
  end

  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil -> not_found(conn)
      %ManufacturingOrder{} = mo -> json(conn, %{mo: Payloads.manufacturing_order(mo)})
    end
  end

  def create(conn, params) do
    actor = conn.assigns.current_user

    case Production.create_manufacturing_order(actor, params) do
      {:ok, mo} ->
        conn
        |> put_status(:created)
        |> json(%{mo: Payloads.manufacturing_order(mo)})

      {:error, code} when is_atom(code) ->
        creation_error(conn, code)

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %ManufacturingOrder{} = mo ->
        case Production.update_manufacturing_order(actor, mo, params) do
          {:ok, updated} ->
            json(conn, %{mo: Payloads.manufacturing_order(updated)})

          {:error, code} when is_atom(code) ->
            creation_error(conn, code)

          {:error, %Ecto.Changeset{} = cs} ->
            changeset_error(conn, cs)
        end
    end
  end

  # POST /api/production/manufacturing-orders/:id/transition
  #
  # Two shapes:
  #   {"action": "prepare" | "unprepare" | "approve" | "reject" | "amend",
  #    "reason": "..."}  -- approval-workflow actions, dispatched
  #                          through Production.* helpers so the
  #                          cascade + 4-eyes + reason rules run.
  #   {"to": "in_progress" | "cancelled" | "completed"}
  #                       -- direct status changes via the existing
  #                          @mo_transitions map.
  def transition(conn, %{"id" => uuid, "action" => action} = params)
      when is_binary(action) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil -> not_found(conn)
      %ManufacturingOrder{} = mo -> dispatch_signature(conn, actor, mo, action, params)
    end
  end

  def transition(conn, %{"id" => uuid, "to" => to}) when is_binary(to) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %ManufacturingOrder{} = mo ->
        case Map.fetch(Production.mo_transitions(), {mo.status, to}) do
          :error ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(
              Errors.payload(
                "invalid_transition",
                "Can't move from #{mo.status} to #{to}.",
                %{from: mo.status, to: to}
              )
            )

          {:ok, perm} ->
            if RBAC.has_permission?(actor, perm) do
              case Production.transition_mo(actor, mo, to) do
                {:ok, updated} ->
                  json(conn, %{mo: Payloads.manufacturing_order(updated)})

                {:error, :invalid_transition, current} ->
                  conn
                  |> put_status(:unprocessable_entity)
                  |> json(
                    Errors.payload(
                      "invalid_transition",
                      "MO is in #{current}; can't move to #{to}.",
                      %{from: current, to: to}
                    )
                  )

                {:error, :children_not_complete} ->
                  conn
                  |> put_status(:unprocessable_entity)
                  |> json(
                    Errors.payload(
                      "children_not_complete",
                      "Finish or cancel every sub-production MO before starting this one.",
                      %{}
                    )
                  )

                {:error, %Ecto.Changeset{} = cs} ->
                  changeset_error(conn, cs)
              end
            else
              forbidden(conn, "Missing #{perm} permission for this transition.")
            end
        end
    end
  end

  # POST /api/production/manufacturing-orders/:id/shift
  # Body: %{"delta_seconds" => integer}. Slides the whole MO chain
  # (header + every step) by `delta_seconds` in one transaction. Used
  # by the production schedule drag handler.
  def shift(conn, %{"id" => uuid, "delta_seconds" => delta}) when is_integer(delta) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %ManufacturingOrder{} = mo ->
        if RBAC.has_permission?(actor, "production.mo_edit") do
          case Production.shift_mo_schedule(actor, mo, delta) do
            {:ok, updated} ->
              json(conn, %{mo: Payloads.manufacturing_order(updated)})

            {:error, %Ecto.Changeset{} = cs} ->
              changeset_error(conn, cs)
          end
        else
          forbidden(conn, "Missing production.mo_edit permission.")
        end
    end
  end

  def shift(conn, _), do: unprocessable(conn, "invalid_payload", "Pass delta_seconds as an integer.")

  # POST /api/production/manufacturing-orders/:id/shift-chain
  # Like /shift but recurses through every descendant in the project
  # so the whole chain moves together. Used by the project-view drag
  # handler on the schedule.
  def shift_chain(conn, %{"id" => uuid, "delta_seconds" => delta}) when is_integer(delta) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %ManufacturingOrder{} = mo ->
        if RBAC.has_permission?(actor, "production.mo_edit") do
          case Production.shift_mo_chain(actor, mo, delta) do
            {:ok, updated} ->
              json(conn, %{mo: Payloads.manufacturing_order(updated)})

            {:error, %Ecto.Changeset{} = cs} ->
              changeset_error(conn, cs)
          end
        else
          forbidden(conn, "Missing production.mo_edit permission.")
        end
    end
  end

  def shift_chain(conn, _),
    do: unprocessable(conn, "invalid_payload", "Pass delta_seconds as an integer.")

  # GET /api/production/manufacturing-orders/:id/merge-candidates
  # Open sub-MOs that produce the same item — picker source for the
  # 'Merge into another batch' dialog.
  def merge_candidates(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %ManufacturingOrder{} = mo ->
        items = Production.list_merge_candidates(actor, mo)

        json(conn, %{
          items:
            Enum.map(items, fn m ->
              %{
                id: m.id,
                uuid: m.uuid,
                code: Backend.Numbering.render(m.id, %Backend.Companies.Company{id: actor.company_id}, "manufacturing_order"),
                status: m.status,
                quantity: Decimal.to_string(m.quantity || Decimal.new(0), :normal),
                item: %{
                  id: m.item.id,
                  name: m.item.name
                },
                parent_mo:
                  case m.parent_mo do
                    nil -> nil
                    p -> %{id: p.id, uuid: p.uuid, code: Backend.Numbering.render(p.id, %Backend.Companies.Company{id: actor.company_id}, "manufacturing_order")}
                  end
              }
            end)
        })
    end
  end

  # POST /api/production/manufacturing-orders/:id/merge-into
  # Body: %{"target_uuid": "..."}. Cancels this MO, bumps the target's
  # qty, records a consumer link from target → this MO's parent.
  def merge_into(conn, %{"id" => uuid, "target_uuid" => target_uuid}) do
    actor = conn.assigns.current_user

    if RBAC.has_permission?(actor, "production.mo_edit") do
      with %ManufacturingOrder{} = source <-
             Production.get_manufacturing_order(actor.company_id, uuid),
           %ManufacturingOrder{} = target <-
             Production.get_manufacturing_order(actor.company_id, target_uuid) do
        case Production.merge_mo_into_batch(actor, source, target) do
          {:ok, merged} ->
            json(conn, %{mo: Payloads.manufacturing_order(merged)})

          {:error, :item_mismatch} ->
            unprocessable(
              conn,
              "item_mismatch",
              "Batches can only be merged when they produce the same item."
            )

          {:error, :source_must_be_sub_mo} ->
            unprocessable(
              conn,
              "source_must_be_sub_mo",
              "Only sub-production runs can be merged into another batch."
            )

          {:error, {:not_pre_execution, status}} ->
            unprocessable(
              conn,
              "not_pre_execution",
              "Both MOs must be in draft or approved — one is currently #{status}."
            )

          {:error, :would_cycle} ->
            unprocessable(
              conn,
              "would_cycle",
              "That merge would create a circular dependency between MOs."
            )

          {:error, :same_mo} ->
            unprocessable(conn, "same_mo", "Can't merge an MO into itself.")

          {:error, %Ecto.Changeset{} = cs} ->
            changeset_error(conn, cs)
        end
      else
        _ -> not_found(conn)
      end
    else
      forbidden(conn, "Missing production.mo_edit permission.")
    end
  end

  def merge_into(conn, _),
    do: unprocessable(conn, "invalid_payload", "Pass target_uuid as a string.")

  # Approval-workflow actions. Each gates on the right permission +
  # dispatches to a Production.* helper that handles the cascade.
  defp dispatch_signature(conn, actor, mo, action, params) do
    with {:ok, perm} <- perm_for_action(action),
         :ok <- check_perm(actor, perm),
         {:ok, result} <- run_signature(actor, mo, action, params) do
      json(conn, %{mo: Payloads.manufacturing_order(result)})
    else
      {:error, :unknown_action} ->
        unprocessable(conn, "unknown_action", "Unknown approval action #{inspect(action)}.")

      {:error, :missing_perm, perm} ->
        forbidden(conn, "Missing #{perm} permission for this action.")

      {:error, :not_root} ->
        unprocessable(
          conn,
          "not_root",
          "Approval is handled at the root MO of this tree."
        )

      {:error, {:invalid_status, current}} ->
        unprocessable(
          conn,
          "invalid_status",
          "MO is #{current}; this action isn't valid from that state."
        )

      {:error, :same_signer} ->
        unprocessable(
          conn,
          "same_signer",
          "Approver must be different from the preparer (4-eyes rule)."
        )

      {:error, :reason_required} ->
        unprocessable(
          conn,
          "reason_required",
          "Rejection needs a reason — type one in the dialog."
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  defp perm_for_action("prepare"), do: {:ok, "production.mo_prepare"}
  defp perm_for_action("unprepare"), do: {:ok, "production.mo_prepare"}
  defp perm_for_action("approve"), do: {:ok, "production.mo_approve"}
  defp perm_for_action("reject"), do: {:ok, "production.mo_approve"}
  defp perm_for_action("amend"), do: {:ok, "production.mo_approve"}
  defp perm_for_action(_), do: {:error, :unknown_action}

  defp check_perm(actor, perm) do
    if RBAC.has_permission?(actor, perm), do: :ok, else: {:error, :missing_perm, perm}
  end

  defp run_signature(actor, mo, "prepare", _params), do: Production.prepare_mo(actor, mo)
  defp run_signature(actor, mo, "unprepare", _params), do: Production.unprepare_mo(actor, mo)
  defp run_signature(actor, mo, "approve", _params), do: Production.approve_mo(actor, mo)
  defp run_signature(actor, mo, "amend", _params), do: Production.amend_mo(actor, mo)

  defp run_signature(actor, mo, "reject", %{"reason" => reason}),
    do: Production.reject_mo(actor, mo, reason)

  defp run_signature(_actor, _mo, "reject", _), do: {:error, :reason_required}

  def delete(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %ManufacturingOrder{} = mo ->
        case Production.delete_manufacturing_order(actor, mo) do
          {:ok, _} -> send_resp(conn, :no_content, "")
          {:error, cs} -> changeset_error(conn, cs)
        end
    end
  end

  # ----- helpers ---------------------------------------------------

  defp creation_error(conn, code) do
    case code do
      :warehouse_required ->
        unprocessable(conn, "warehouse_required", "Pick a production site.")

      :warehouse_not_found ->
        unprocessable(conn, "warehouse_not_found", "Site doesn't exist.")

      :site_must_be_production_facility ->
        unprocessable(
          conn,
          "site_must_be_production_facility",
          "MOs run on production sites, not warehouse-kind storage."
        )

      :bom_required ->
        unprocessable(conn, "bom_required", "Pick a Bill of Materials.")

      :bom_not_found ->
        unprocessable(conn, "bom_not_found", "Selected BOM doesn't exist.")

      :bom_item_mismatch ->
        unprocessable(
          conn,
          "bom_item_mismatch",
          "BOM builds a different item — pick a BOM for the same product."
        )

      other ->
        unprocessable(conn, to_string(other), "Validation failed: #{other}")
    end
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

  defp not_found(conn) do
    conn
    |> put_status(:not_found)
    |> json(Errors.payload("not_found", "Manufacturing order not found.", %{}))
  end

  defp unprocessable(conn, code, detail) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(Errors.payload(code, detail, %{}))
  end

  defp forbidden(conn, detail) do
    conn
    |> put_status(:forbidden)
    |> json(Errors.payload("forbidden", detail, %{}))
  end

  defp changeset_error(conn, cs) do
    payload =
      Errors.payload(
        "validation_failed",
        "One or more fields failed validation.",
        Errors.changeset_fields(cs)
      )

    conn
    |> put_status(:unprocessable_entity)
    |> json(payload)
  end
end
