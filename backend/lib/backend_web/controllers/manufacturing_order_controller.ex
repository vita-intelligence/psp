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

  plug RequirePermission,
       "production.mo_edit"
       when action in [:apply_bom_override, :revert_bom_override]

  plug RequirePermission,
       "production.mo_release"
       when action in [:release, :unrelease, :clear_replan]

  def index(conn, params) do
    actor = conn.assigns.current_user

    opts =
      [
        cursor: params["cursor"],
        limit: params["limit"],
        sort: parse_sort(params["sort"]),
        search: params["search"],
        column_filter: params["column_filter"],
        status: params["status"],
        item_id: params["item_id"],
        warehouse_id: params["warehouse_id"],
        # Stream tab on the ledger — `production` narrows to
        # project_type=production, `rnd` narrows to trial/sample.
        # Absent / `all` = no filter.
        stream: params["stream"]
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

  # POST /api/production/manufacturing-orders/:id/bom-overrides
  #
  # Body shapes:
  #   {"action": "removed",     "bom_line_id": 42, "reason": "..."}
  #   {"action": "qty_changed", "bom_line_id": 42, "to_qty": "10.5"}
  #   {"action": "added",       "item_id": 99,     "to_qty": "5.0",
  #    "unit_of_measurement_id": 3, "is_fixed": false}
  #
  # Response: {mo: <full MO payload with overrides applied>} so the
  # FE parts table refreshes atomically without a follow-up GET.
  def apply_bom_override(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %ManufacturingOrder{} = mo ->
        attrs = Map.take(params, [
          "action",
          "bom_line_id",
          "item_id",
          "unit_of_measurement_id",
          "to_qty",
          "is_fixed",
          "reason"
        ])

        case Production.apply_mo_bom_override(actor, mo, attrs) do
          {:ok, _override} ->
            refreshed = Production.get_manufacturing_order(actor.company_id, uuid)
            json(conn, %{mo: Payloads.manufacturing_order(refreshed)})

          {:error, :mo_locked} ->
            unprocessable(
              conn,
              "mo_locked",
              "Bring the MO back to draft to change its BOM."
            )

          {:error, :bom_line_not_found} ->
            unprocessable(
              conn,
              "bom_line_not_found",
              "That BOM line isn't on this MO's BOM."
            )

          {:error, :invalid_shape} ->
            unprocessable(
              conn,
              "invalid_shape",
              "Pass action + the fields it requires."
            )

          {:error, %Ecto.Changeset{} = cs} ->
            changeset_error(conn, cs)
        end
    end
  end

  # DELETE /api/production/manufacturing-orders/:id/bom-overrides/:override_uuid
  #
  # Reverts a single override so the effective BOM collapses back to
  # the master row (or drops the injected part entirely for adds).
  def revert_bom_override(conn, %{"id" => uuid, "override_uuid" => override_uuid}) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %ManufacturingOrder{} = mo ->
        case Production.revert_mo_bom_override(actor, mo, override_uuid) do
          {:ok, _deleted} ->
            refreshed = Production.get_manufacturing_order(actor.company_id, uuid)
            json(conn, %{mo: Payloads.manufacturing_order(refreshed)})

          {:error, :mo_locked} ->
            unprocessable(
              conn,
              "mo_locked",
              "Bring the MO back to draft to change its BOM."
            )

          {:error, :not_found} ->
            not_found(conn)

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

            {:error, :past_time} ->
              unprocessable(
                conn,
                "past_time",
                "Can't drag the block before the current time."
              )

            {:error, :mo_terminal} ->
              unprocessable(
                conn,
                "mo_terminal",
                "This MO is already completed or cancelled — its dates are frozen and can't be moved."
              )

            {:error, :must_finish_before_parent} ->
              unprocessable(
                conn,
                "chain_order",
                "This MO must finish before its parent MO starts."
              )

            {:error, :must_start_after_children} ->
              unprocessable(
                conn,
                "chain_order",
                "This MO must start after every sub-MO finishes."
              )

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

            {:error, :past_time} ->
              unprocessable(
                conn,
                "past_time",
                "Can't shift the chain into the past — pick a future time."
              )

            {:error, :mo_terminal} ->
              unprocessable(
                conn,
                "mo_terminal",
                "This chain's root MO is already completed or cancelled — the chain's dates are frozen and can't be moved."
              )

            {:error, %Ecto.Changeset{} = cs} ->
              changeset_error(conn, cs)

            {:error, reason} when is_atom(reason) ->
              unprocessable(conn, Atom.to_string(reason), "Couldn't shift the chain: #{reason}.")
          end
        else
          forbidden(conn, "Missing production.mo_edit permission.")
        end
    end
  end

  def shift_chain(conn, _),
    do: unprocessable(conn, "invalid_payload", "Pass delta_seconds as an integer.")

  # POST /api/production/manufacturing-orders/:id/schedule
  # Body: %{"start_at" => ISO datetime}. Places an approved MO on
  # the calendar starting at `start_at` — walks the steps forward
  # respecting working hours. Flips status to "scheduled". Returns
  # `outside_hours_seconds` so the FE can warn when the placement
  # spilled past available working windows.
  def schedule(conn, %{"id" => uuid, "start_at" => start_raw} = params) when is_binary(start_raw) do
    actor = conn.assigns.current_user

    opts =
      case params["workstation_group_id"] do
        nil -> []
        wsg when is_integer(wsg) -> [workstation_group_id: wsg]
        wsg when is_binary(wsg) ->
          case Integer.parse(wsg) do
            {n, ""} -> [workstation_group_id: n]
            _ -> []
          end
        _ -> []
      end

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %ManufacturingOrder{} = mo ->
        if RBAC.has_permission?(actor, "production.mo_edit") do
          with {:ok, dt, _offset} <- DateTime.from_iso8601(start_raw),
               {:ok, updated, meta} <-
                 Production.schedule_mo(
                   actor,
                   mo,
                   DateTime.shift_zone!(dt, "Etc/UTC"),
                   opts
                 ) do
            json(conn, %{
              mo: Payloads.manufacturing_order(updated),
              outside_hours_seconds: meta.outside_hours_seconds
            })
          else
            {:error, :wrong_status} ->
              unprocessable(conn, "wrong_status", "MO must be approved or scheduled to schedule.")

            {:error, :past_time} ->
              unprocessable(
                conn,
                "past_time",
                "Can't schedule before the current time."
              )

            {:error, :must_finish_before_parent} ->
              unprocessable(
                conn,
                "chain_order",
                "This MO must finish before its parent MO starts. Reschedule the parent later or this MO earlier."
              )

            {:error, :must_start_after_children} ->
              unprocessable(
                conn,
                "chain_order",
                "This MO must start after every sub-MO finishes — the sub-MOs make inputs this run consumes."
              )

            {:error, %Ecto.Changeset{} = cs} ->
              changeset_error(conn, cs)

            _ ->
              unprocessable(conn, "invalid_payload", "Pass start_at as an ISO datetime.")
          end
        else
          forbidden(conn, "Missing production.mo_edit permission.")
        end
    end
  end

  def schedule(conn, _),
    do: unprocessable(conn, "invalid_payload", "Pass start_at as an ISO datetime.")

  # POST /api/production/manufacturing-orders/:id/schedule-chain
  # Body: %{"start_at" => ISO datetime}. Schedules the entire chain:
  # root forward from start_at, then each child backward from the
  # root's first step so the child finishes before the parent begins.
  def schedule_chain(conn, %{"id" => uuid, "start_at" => start_raw}) when is_binary(start_raw) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %ManufacturingOrder{} = mo ->
        if RBAC.has_permission?(actor, "production.mo_edit") do
          with {:ok, dt, _offset} <- DateTime.from_iso8601(start_raw),
               {:ok, updated, meta} <-
                 Production.schedule_mo_chain(
                   actor,
                   mo,
                   DateTime.shift_zone!(dt, "Etc/UTC")
                 ) do
            json(conn, %{
              mo: Payloads.manufacturing_order(updated),
              outside_hours_seconds: meta.outside_hours_seconds
            })
          else
            {:error, :wrong_status} ->
              unprocessable(conn, "wrong_status", "Root MO must be approved or scheduled.")

            {:error, :past_time} ->
              unprocessable(
                conn,
                "past_time",
                "Can't schedule the project before the current time."
              )

            {:error, %Ecto.Changeset{} = cs} ->
              changeset_error(conn, cs)

            _ ->
              unprocessable(conn, "invalid_payload", "Pass start_at as an ISO datetime.")
          end
        else
          forbidden(conn, "Missing production.mo_edit permission.")
        end
    end
  end

  def schedule_chain(conn, _),
    do: unprocessable(conn, "invalid_payload", "Pass start_at as an ISO datetime.")

  # POST /api/production/manufacturing-orders/:id/unschedule-chain
  # Sends an entire MO chain back to the backlog. Walks every
  # scheduled descendant. Used by the project view's drag-to-backlog.
  def unschedule_chain(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %ManufacturingOrder{} = mo ->
        if RBAC.has_permission?(actor, "production.mo_edit") do
          case Production.unschedule_mo_chain(actor, mo) do
            {:ok, updated} ->
              json(conn, %{mo: Payloads.manufacturing_order(updated)})

            {:error, %Ecto.Changeset{} = cs} ->
              changeset_error(conn, cs)

            {:error, reason} ->
              unprocessable(conn, "unschedule_failed", inspect(reason))
          end
        else
          forbidden(conn, "Missing production.mo_edit permission.")
        end
    end
  end

  # POST /api/production/manufacturing-orders/:id/unschedule
  # Sends a scheduled MO back to the backlog. Clears every step's
  # planned_start + planned_finish. Status returns to "approved".
  def unschedule(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %ManufacturingOrder{} = mo ->
        if RBAC.has_permission?(actor, "production.mo_edit") do
          case Production.unschedule_mo(actor, mo) do
            {:ok, updated} ->
              json(conn, %{mo: Payloads.manufacturing_order(updated)})

            {:error, :wrong_status} ->
              unprocessable(conn, "wrong_status", "MO can't be unscheduled in its current status.")

            {:error, :not_on_calendar} ->
              unprocessable(conn, "not_on_calendar", "MO isn't on the calendar.")

            {:error, %Ecto.Changeset{} = cs} ->
              changeset_error(conn, cs)
          end
        else
          forbidden(conn, "Missing production.mo_edit permission.")
        end
    end
  end

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

      {:error, :already_released} ->
        unprocessable(
          conn,
          "already_released",
          "MO is already released to the warehouse — pull it back from the schedule before unapproving."
        )

      {:error, :nothing_to_request} ->
        unprocessable(
          conn,
          "nothing_to_request",
          "Every BOM line is already fully booked — nothing to send to procurement."
        )

      {:error, :lines_under_booked, list} ->
        short =
          list
          |> Enum.map(fn s -> "#{s.item_name} short by #{s.short}" end)
          |> Enum.join("; ")

        unprocessable(
          conn,
          "lines_under_booked",
          "MO can't advance — these BOM lines aren't booked: #{short}. Either book the missing qty from stock, or click Send to procurement so the purchases team can raise a PO.",
          %{lines: list}
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  defp perm_for_action("prepare"), do: {:ok, "production.mo_prepare"}
  defp perm_for_action("unprepare"), do: {:ok, "production.mo_prepare"}
  defp perm_for_action("approve"), do: {:ok, "production.mo_approve"}
  defp perm_for_action("unapprove"), do: {:ok, "production.mo_approve"}
  defp perm_for_action("request_purchases"), do: {:ok, "production.mo_prepare"}
  defp perm_for_action("cancel_purchase_request"), do: {:ok, "production.mo_prepare"}
  defp perm_for_action("reject"), do: {:ok, "production.mo_approve"}
  defp perm_for_action("amend"), do: {:ok, "production.mo_approve"}
  defp perm_for_action(_), do: {:error, :unknown_action}

  defp check_perm(actor, perm) do
    if RBAC.has_permission?(actor, perm), do: :ok, else: {:error, :missing_perm, perm}
  end

  defp run_signature(actor, mo, "prepare", _params), do: Production.prepare_mo(actor, mo)
  defp run_signature(actor, mo, "unprepare", _params), do: Production.unprepare_mo(actor, mo)
  defp run_signature(actor, mo, "approve", _params), do: Production.approve_mo(actor, mo)
  defp run_signature(actor, mo, "unapprove", _params), do: Production.unapprove_mo(actor, mo)
  defp run_signature(actor, mo, "request_purchases", _params), do: Production.request_purchases(actor, mo)
  defp run_signature(actor, mo, "cancel_purchase_request", _params), do: Production.cancel_purchase_request(actor, mo)
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

  # POST /api/production/manufacturing-orders/:id/release-to-warehouse
  # Body: %{"pickup_window_hours": integer | nil}
  #
  # Planner action — release a scheduled MO to the warehouse picker
  # queue. Refuses if any booked lot isn't `available` (stale-booking
  # guard — QC must be done before release).
  def release(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %ManufacturingOrder{} = mo ->
        opts =
          case params["pickup_window_hours"] do
            n when is_integer(n) and n > 0 -> [pickup_window_hours: n]
            n when is_binary(n) ->
              case Integer.parse(n) do
                {parsed, ""} when parsed > 0 -> [pickup_window_hours: parsed]
                _ -> []
              end
            _ -> []
          end

        case Production.release_mo_to_warehouse(actor, mo, opts) do
          {:ok, updated} ->
            json(conn, %{mo: Payloads.manufacturing_order(updated)})

          {:error, {:invalid_status, current}} ->
            unprocessable(
              conn,
              "wrong_status",
              "MO is #{current}; release requires an approved MO that's on the calendar."
            )

          {:error, :not_on_calendar} ->
            unprocessable(
              conn,
              "not_on_calendar",
              "Place the MO on the calendar before releasing it to the warehouse."
            )

          {:error, :children_not_closed_out, list} ->
            # Sub-MO(s) haven't finished closeout yet. Parent's pickup
            # queue would run into an ingredient that isn't at
            # production yet. Surface the offenders so the FE can
            # deep-link the operator to each child's closeout page.
            n = length(list)

            conn
            |> put_status(:unprocessable_entity)
            |> json(
              Errors.payload(
                "children_not_closed_out",
                "Waiting on closeout of #{n} sub-MO(s). Sign off closeout on each before requesting pickup — that's how the sub-output physically transitions to being pickable by this MO.",
                %{pending_child_mo_uuids: Enum.map(list, & &1.uuid)}
              )
            )

          {:error, :stale_bookings, list} ->
            not_available =
              list
              |> Enum.map(fn s -> s.lot_status end)
              |> Enum.uniq()
              |> Enum.sort()
              |> Enum.join(", ")

            conn
            |> put_status(:unprocessable_entity)
            |> json(
              Errors.payload(
                "stale_bookings",
                "One or more booked lots aren't `available` yet (currently: #{not_available}). Quarantine and on-hold both block release — resolve QC first, then retry.",
                %{bookings: list}
              )
            )

          {:error, :lines_under_booked, list} ->
            short =
              list
              |> Enum.map(fn s ->
                "#{s.item_name}: short by #{s.short} (need #{s.required}, booked #{s.booked})"
              end)
              |> Enum.join("; ")

            conn
            |> put_status(:unprocessable_entity)
            |> json(
              Errors.payload(
                "lines_under_booked",
                "MO isn't ready to release — these BOM lines aren't fully booked: #{short}. Book the missing qty, or wait for the child MO that produces it to finish.",
                %{lines: list}
              )
            )

          {:error, :lines_not_lot_booked, list} ->
            short =
              list
              |> Enum.map(fn s ->
                "#{s.item_name}: short by #{s.short}"
              end)
              |> Enum.join("; ")

            conn
            |> put_status(:unprocessable_entity)
            |> json(
              Errors.payload(
                "lines_not_lot_booked",
                "Some BOM lines are still waiting on a child MO's output (#{short}). Finish + pass QC on the child MO so its lot exists, then book it here before releasing.",
                %{lines: list}
              )
            )

          {:error, :lots_not_in_warehouse, list} ->
            short =
              list
              |> Enum.map(fn s ->
                "#{s.item_name} (lot #{String.slice(s.lot_uuid, 0, 8)}…): only #{s.in_warehouse_qty} of #{s.booked_qty} in a warehouse cell"
              end)
              |> Enum.join("; ")

            conn
            |> put_status(:unprocessable_entity)
            |> json(
              Errors.payload(
                "lots_not_in_warehouse",
                "One or more booked lots aren't fully back in the warehouse yet: #{short}. Run the return-pickup flow so the picker can move them from production into a regular cell, then release.",
                %{lots: list}
              )
            )

          {:error, :lots_on_trolley, list} ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(
              Errors.payload(
                "lots_on_trolley",
                "One or more booked lots are currently on another MO's trolley — wait for that pickup to finish or abort.",
                %{bookings: list}
              )
            )

          {:error, %Ecto.Changeset{} = cs} ->
            changeset_error(conn, cs)
        end
    end
  end

  # DELETE /api/production/manufacturing-orders/:id/release-to-warehouse
  #
  # Planner action — pull an MO back from the warehouse queue. Only
  # allowed if pickup hasn't started yet.
  def unrelease(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %ManufacturingOrder{} = mo ->
        # Optional replan annotation — set by the planner when
        # they're pulling back to fix something rather than just
        # rescheduling. Stamps `needs_replan = true` so the MO
        # can't be released again until they explicitly clear it.
        opts =
          case params do
            %{"needs_replan" => true, "reason" => reason} when is_binary(reason) ->
              [needs_replan: true, reason: reason]

            _ ->
              []
          end

        case Production.unrelease_mo_from_warehouse(actor, mo, opts) do
          {:ok, updated} ->
            json(conn, %{mo: Payloads.manufacturing_order(updated)})

          {:error, :not_released} ->
            unprocessable(conn, "not_released", "MO isn't currently released.")

          {:error, :pickup_in_progress} ->
            unprocessable(
              conn,
              "pickup_in_progress",
              "Picker has started — wait for them to finish or abort first."
            )

          {:error, %Ecto.Changeset{} = cs} ->
            changeset_error(conn, cs)
        end
    end
  end

  # POST /api/production/manufacturing-orders/:id/clear-replan
  #
  # Planner action — clear the `needs_replan` flag after they've
  # reviewed + fixed the bookings. Refuses if the MO is still
  # under-booked (ensure_all_lines_fully_booked guard) so the flag
  # can't be cleared while the underlying problem still exists.
  def clear_replan(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %ManufacturingOrder{} = mo ->
        case Production.clear_replan(actor, mo) do
          {:ok, updated} ->
            json(conn, %{mo: Payloads.manufacturing_order(updated)})

          {:error, :lines_under_booked, list} ->
            short =
              list
              |> Enum.map(fn s -> "#{s.item_name} short by #{s.short}" end)
              |> Enum.join("; ")

            unprocessable(
              conn,
              "lines_under_booked",
              "Bookings still don't cover the BOM: #{short}. Add bookings or spawn a child MO before clearing replan.",
              %{lines: list}
            )

          {:error, %Ecto.Changeset{} = cs} ->
            changeset_error(conn, cs)
        end
    end
  end

  # GET /api/production/output-qc
  # Output stock lots awaiting production-QC sign-off. Gated by the
  # dedicated `production.qc_output` perm so a finished-goods QC role
  # can be granted without also handing out `stock.qc` (which covers
  # incoming PO inspections).
  def output_qc_queue(conn, params) do
    actor = conn.assigns.current_user

    if RBAC.has_permission?(actor, "production.qc_output") do
      opts = [
        limit: params["limit"],
        cursor: params["cursor"],
        search: params["search"],
        filter_item_type: params["item_type"],
        filter_project_type: params["project_type"],
        filter_workstation_group_uuid: params["workstation_group_uuid"]
      ]

      {entries, next_cursor} =
        Production.list_pending_output_qc(actor.company_id, opts)

      json(conn, %{
        items: Enum.map(entries, &Payloads.output_qc_entry/1),
        next_cursor: next_cursor
      })
    else
      forbidden(conn, "Missing production.qc_output permission.")
    end
  end

  # GET /api/production/output-qc/:lot_uuid
  # Single-entry fetch for the detail page. Same shape as one row of
  # the queue.
  def output_qc_show(conn, %{"lot_uuid" => uuid}) do
    actor = conn.assigns.current_user

    if RBAC.has_permission?(actor, "production.qc_output") do
      case Production.get_output_qc_entry_by_lot_uuid(actor.company_id, uuid) do
        nil -> {:error, :not_found}
        entry -> json(conn, %{entry: Payloads.output_qc_entry(entry)})
      end
    else
      forbidden(conn, "Missing production.qc_output permission.")
    end
  end

  # GET /api/production/output-qc/:lot_uuid/npd-spec.html
  #
  # Server-side proxy to NPD's `/api/psp-integration/specifications/latest.html`.
  # Returns the same HTML NPD renders for its Spec Sheet page (WeasyPrint
  # template) so PSP can iframe it and show QA an identical document —
  # the same primitives, actives / nutrition / amino-acids / excipients /
  # ingredients / signatures / workflow-history the NPD user sees.
  #
  # Auth chain:
  #   * PSP session (permission `production.qc_output`) gates the browser.
  #   * PSP → NPD server-to-server bearer (`company.npd_integration_token`).
  #     The NPD URL is never exposed to the browser; PSP proxies the body.
  #
  # Errors surface as HTML fragments (not JSON) so an iframe pointed at
  # this endpoint always renders something — a broken sheet + a reason
  # beats an empty white iframe.
  def output_qc_npd_spec_html(conn, %{"lot_uuid" => uuid}) do
    actor = conn.assigns.current_user

    with :ok <- require_permission(actor, "production.qc_output"),
         {:ok, item_uuid, _source} <-
           Production.resolve_output_qc_reference_item_uuid(actor.company_id, uuid),
         company <- Backend.Companies.current(),
         :ok <- ensure_npd_live(company),
         {:ok, html} <- fetch_npd_spec_html(company, item_uuid) do
      conn
      |> put_resp_content_type("text/html")
      |> put_resp_header("cache-control", "no-store")
      |> put_resp_header("x-frame-options", "SAMEORIGIN")
      |> send_resp(200, html)
    else
      {:error, :forbidden} ->
        html_stub(conn, 403, "Missing production.qc_output permission.")

      {:error, :lot_not_found} ->
        html_stub(conn, 404, "Lot not found or not awaiting Output QC.")

      {:error, :no_reference_item} ->
        html_stub(
          conn,
          404,
          "No reference item on this lot — neither the lot's item nor any ancestor MO carries a finished-product spec."
        )

      {:error, :npd_not_configured} ->
        html_stub(
          conn,
          503,
          "NPD integration isn't configured. Set the base URL + token on /settings/integrations."
        )

      {:error, :npd_not_found} ->
        html_stub(
          conn,
          404,
          "NPD has no spec sheet on file for this product yet."
        )

      {:error, {:npd_error, status}} ->
        html_stub(conn, 502, "NPD returned #{status} while rendering the sheet.")

      {:error, {:transport, reason}} ->
        html_stub(
          conn,
          502,
          "Couldn't reach NPD: #{inspect(reason)}."
        )
    end
  end

  # GET /api/production/manufacturing-orders/:uuid/npd-spec.html
  #
  # Same NPD-embed pattern as `output_qc_npd_spec_html/2` but keyed on
  # an MO uuid. Resolves the reference item (walks the parent chain
  # when the MO's own item lacks a spec) and streams NPD's rendered
  # HTML back for iframe embedding on the MO detail page.
  def mo_npd_spec_html(conn, %{"uuid" => uuid}) do
    actor = conn.assigns.current_user

    with :ok <- require_permission(actor, "production.mo_view"),
         {:ok, item_uuid, _source} <-
           Production.resolve_reference_item_uuid_for_mo(actor.company_id, uuid),
         company <- Backend.Companies.current(),
         :ok <- ensure_npd_live(company),
         {:ok, html} <- fetch_npd_spec_html(company, item_uuid) do
      conn
      |> put_resp_content_type("text/html")
      |> put_resp_header("cache-control", "no-store")
      |> put_resp_header("x-frame-options", "SAMEORIGIN")
      |> send_resp(200, html)
    else
      {:error, :forbidden} ->
        html_stub(conn, 403, "Missing production.mo_view permission.")

      {:error, :mo_not_found} ->
        html_stub(conn, 404, "Manufacturing order not found.")

      {:error, :no_reference_item} ->
        html_stub(
          conn,
          404,
          "No spec on file — neither this MO's item nor any ancestor carries a finished-product spec."
        )

      {:error, :npd_not_configured} ->
        html_stub(
          conn,
          503,
          "NPD integration isn't configured. Set the base URL + token on /settings/integrations."
        )

      {:error, :npd_not_found} ->
        html_stub(conn, 404, "NPD has no spec sheet on file for this product yet.")

      {:error, {:npd_error, status}} ->
        html_stub(conn, 502, "NPD returned #{status} while rendering the sheet.")

      {:error, {:transport, reason}} ->
        html_stub(conn, 502, "Couldn't reach NPD: #{inspect(reason)}.")
    end
  end

  defp require_permission(actor, perm) do
    if RBAC.has_permission?(actor, perm), do: :ok, else: {:error, :forbidden}
  end

  defp ensure_npd_live(company) do
    if Backend.Companies.npd_integration_live?(company),
      do: :ok,
      else: {:error, :npd_not_configured}
  end

  defp fetch_npd_spec_html(company, item_uuid) do
    base = String.trim_trailing(company.npd_base_url, "/")
    url = base <> "/api/psp-integration/specifications/latest.html"

    req =
      Req.new(
        url: url,
        params: [psp_item_uuid: item_uuid],
        headers: [{"authorization", "Bearer " <> company.npd_integration_token}],
        receive_timeout: 15_000
      )

    case Req.get(req) do
      {:ok, %Req.Response{status: 200, body: body}} when is_binary(body) ->
        {:ok, body}

      {:ok, %Req.Response{status: 404}} ->
        {:error, :npd_not_found}

      {:ok, %Req.Response{status: status}} ->
        {:error, {:npd_error, status}}

      {:error, reason} ->
        {:error, {:transport, reason}}
    end
  end

  # GET /api/production/output-qc/:lot_uuid/npd-validation.html
  #
  # Sibling of ``output_qc_npd_spec_html/2`` — proxies NPD's rendered
  # product-validation sheet for the trial batch attached to the lot's
  # producing MO. Returns 404 when the MO has no ``npd_trial_batch_uuid``
  # (non-R&D lots) or when NPD has no passed/failed validation yet
  # (the sheet only surfaces terminal-state validations; draft /
  # in_progress aren't meaningful QA artefacts).
  def output_qc_npd_validation_html(conn, %{"lot_uuid" => uuid}) do
    actor = conn.assigns.current_user

    with :ok <- require_permission(actor, "production.qc_output"),
         {:ok, ref} <-
           validation_ref_for_output_qc_lot(actor.company_id, uuid),
         company <- Backend.Companies.current(),
         :ok <- ensure_npd_live(company),
         {:ok, html} <- fetch_npd_validation_html(company, ref) do
      conn
      |> put_resp_content_type("text/html")
      |> put_resp_header("cache-control", "no-store")
      |> put_resp_header("x-frame-options", "SAMEORIGIN")
      |> send_resp(200, html)
    else
      {:error, :forbidden} ->
        html_stub(conn, 403, "Missing production.qc_output permission.")

      {:error, :lot_not_found} ->
        html_stub(conn, 404, "Lot not found or not awaiting Output QC.")

      {:error, :no_trial_batch} ->
        html_stub(
          conn,
          404,
          "This lot's MO isn't linked to an NPD trial batch and its formulation has no canonical validation — no validation to show."
        )

      {:error, :npd_not_configured} ->
        html_stub(conn, 503, "NPD integration isn't configured.")

      {:error, :npd_not_found} ->
        html_stub(
          conn,
          404,
          "NPD hasn't recorded a passed validation for this formulation yet."
        )

      {:error, {:npd_error, status}} ->
        html_stub(conn, 502, "NPD returned #{status} while rendering the validation.")

      {:error, {:transport, reason}} ->
        html_stub(conn, 502, "Couldn't reach NPD: #{inspect(reason)}.")
    end
  end

  # GET /api/production/manufacturing-orders/:uuid/npd-validation.html
  # Same as `output_qc_npd_validation_html/2`, keyed by MO uuid.
  def mo_npd_validation_html(conn, %{"uuid" => uuid}) do
    actor = conn.assigns.current_user

    with :ok <- require_permission(actor, "production.mo_view"),
         {:ok, ref} <-
           validation_ref_for_mo(actor.company_id, uuid),
         company <- Backend.Companies.current(),
         :ok <- ensure_npd_live(company),
         {:ok, html} <- fetch_npd_validation_html(company, ref) do
      conn
      |> put_resp_content_type("text/html")
      |> put_resp_header("cache-control", "no-store")
      |> put_resp_header("x-frame-options", "SAMEORIGIN")
      |> send_resp(200, html)
    else
      {:error, :forbidden} ->
        html_stub(conn, 403, "Missing production.mo_view permission.")

      {:error, :mo_not_found} ->
        html_stub(conn, 404, "Manufacturing order not found.")

      {:error, :no_trial_batch} ->
        html_stub(
          conn,
          404,
          "This MO isn't linked to an NPD trial batch and its formulation has no canonical validation — no validation to show."
        )

      {:error, :npd_not_configured} ->
        html_stub(conn, 503, "NPD integration isn't configured.")

      {:error, :npd_not_found} ->
        html_stub(
          conn,
          404,
          "NPD hasn't recorded a passed validation for this formulation yet."
        )

      {:error, {:npd_error, status}} ->
        html_stub(conn, 502, "NPD returned #{status} while rendering the validation.")

      {:error, {:transport, reason}} ->
        html_stub(conn, 502, "Couldn't reach NPD: #{inspect(reason)}.")
    end
  end

  # Resolve the NPD lookup reference for a lot at Output QC.
  #
  # Returns one of:
  #
  #   * ``{:ok, {:trial_batch, uuid}}`` — this MO (or a parent MO)
  #     owns its own npd_trial_batch_uuid, use it.
  #
  #   * ``{:ok, {:formulation, uuid}}`` — no trial batch on the chain,
  #     but the MO carries an ``npd_formulation_uuid``. NPD's
  #     ``latest.html`` endpoint accepts ``?formulation=`` and
  #     resolves the canonical passed validation for that formulation
  #     — the compliance artefact that let the formulation ship as a
  #     sample in the first place. This is the sample-of-approved-RTG
  #     path: the sample MO is a production run of an already-
  #     approved recipe, so its OWN validation doesn't exist yet, but
  #     the RTG's canonical trial-batch validation is what QA needs
  #     to see on the QC page.
  defp validation_ref_for_output_qc_lot(company_id, lot_uuid) do
    import Ecto.Query

    with %Backend.Stock.Lot{source_kind: "manufacturing_order", source_ref: mo_uuid} <-
           Backend.Stock.get_for_company(company_id, lot_uuid),
         %Backend.Production.ManufacturingOrder{} = mo <-
           Backend.Repo.one(
             from m in Backend.Production.ManufacturingOrder,
               where:
                 m.company_id == ^company_id and
                   fragment("?::text", m.uuid) == ^mo_uuid
           ) do
      resolve_validation_ref(company_id, mo)
    else
      nil -> {:error, :lot_not_found}
      %Backend.Stock.Lot{} -> {:error, :lot_not_found}
    end
  end

  defp validation_ref_for_mo(company_id, mo_uuid) do
    import Ecto.Query

    case Backend.Repo.one(
           from m in Backend.Production.ManufacturingOrder,
             where: m.company_id == ^company_id and m.uuid == ^mo_uuid
         ) do
      nil ->
        {:error, :mo_not_found}

      mo ->
        resolve_validation_ref(company_id, mo)
    end
  end

  # Preference order: (1) MO's own trial batch → (2) any ancestor's
  # trial batch → (3) MO's formulation (canonical-validation
  # fallback). Sample MOs typically bottom out on (3).
  defp resolve_validation_ref(company_id, mo) do
    case mo do
      %{npd_trial_batch_uuid: uuid} when is_binary(uuid) and byte_size(uuid) > 0 ->
        {:ok, {:trial_batch, uuid}}

      _ ->
        case trial_batch_from_ancestors(company_id, mo) do
          {:ok, uuid} -> {:ok, {:trial_batch, uuid}}
          {:error, :no_trial_batch} -> formulation_ref(mo)
        end
    end
  end

  defp formulation_ref(%{npd_formulation_uuid: uuid})
       when is_binary(uuid) and byte_size(uuid) > 0,
       do: {:ok, {:formulation, uuid}}

  defp formulation_ref(_), do: {:error, :no_trial_batch}

  defp trial_batch_from_ancestors(company_id, mo) do
    case mo.parent_mo_id do
      nil ->
        {:error, :no_trial_batch}

      parent_id ->
        parent = Backend.Repo.get(Backend.Production.ManufacturingOrder, parent_id)

        case parent do
          %{company_id: ^company_id, npd_trial_batch_uuid: uuid}
          when is_binary(uuid) and byte_size(uuid) > 0 ->
            {:ok, uuid}

          %{company_id: ^company_id} = parent_mo ->
            trial_batch_from_ancestors(company_id, parent_mo)

          _ ->
            {:error, :no_trial_batch}
        end
    end
  end

  defp fetch_npd_validation_html(company, ref) do
    base = String.trim_trailing(company.npd_base_url, "/")
    url = base <> "/api/psp-integration/validations/latest.html"

    params =
      case ref do
        {:trial_batch, uuid} -> [trial_batch: uuid]
        {:formulation, uuid} -> [formulation: uuid]
      end

    req =
      Req.new(
        url: url,
        params: params,
        headers: [{"authorization", "Bearer " <> company.npd_integration_token}],
        receive_timeout: 15_000
      )

    case Req.get(req) do
      {:ok, %Req.Response{status: 200, body: body}} when is_binary(body) ->
        {:ok, body}

      {:ok, %Req.Response{status: 404}} ->
        {:error, :npd_not_found}

      {:ok, %Req.Response{status: status}} ->
        {:error, {:npd_error, status}}

      {:error, reason} ->
        {:error, {:transport, reason}}
    end
  end

  defp html_stub(conn, status, message) do
    body = """
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Spec sheet unavailable</title>
        <style>
          body {
            font-family: Arial, Helvetica, sans-serif;
            padding: 32px;
            color: #111;
            background: #fff;
            font-size: 13px;
          }
          .card {
            max-width: 520px;
            margin: 48px auto;
            border: 1px solid #ddd;
            padding: 24px;
            border-radius: 8px;
          }
          h1 {
            font-size: 15px;
            margin: 0 0 8px 0;
          }
          p { margin: 0; color: #444; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Spec sheet unavailable</h1>
          <p>#{Plug.HTML.html_escape(message)}</p>
        </div>
      </body>
    </html>
    """

    conn
    |> put_resp_content_type("text/html")
    |> send_resp(status, body)
  end

  # POST /api/production/output-qc/:lot_uuid
  # Body: %{"verdict" => "pass" | "fail", "reason" => string (optional)}
  def output_qc_sign_off(conn, %{"lot_uuid" => uuid} = params) do
    actor = conn.assigns.current_user

    if RBAC.has_permission?(actor, "production.qc_output") do
      verdict = params["verdict"]

      case Production.sign_off_output_qc(actor, uuid, verdict, params) do
        {:ok, lot} ->
          json(conn, %{lot: Payloads.stock_lot(lot)})

        {:error, :bad_verdict} ->
          unprocessable(
            conn,
            "bad_verdict",
            "verdict must be `pass` or `fail`."
          )

        {:error, :lot_not_found} ->
          not_found(conn)

        {:error, :not_a_manufactured_lot} ->
          unprocessable(
            conn,
            "not_a_manufactured_lot",
            "Output QC only applies to manufacturing-order lots — incoming PO lots use the Goods-In Inspection flow."
          )

        {:error, :bad_reject_qty} ->
          unprocessable(
            conn,
            "bad_reject_qty",
            "reject_qty must be a positive number."
          )

        {:error, :reject_qty_exceeds_lot} ->
          unprocessable(
            conn,
            "reject_qty_exceeds_lot",
            "reject_qty can't be larger than the lot's current quantity."
          )

        {:error, :missing_partial_packaging} ->
          unprocessable(
            conn,
            "missing_partial_packaging",
            "Partial fail requires new packaging dimensions for both the remainder and the rejected portion."
          )

        {:error, {:bad_pack_field, field}} ->
          unprocessable(
            conn,
            "bad_pack_field",
            "Packaging field `#{field}` must be a positive number."
          )

        {:error, :no_active_placement} ->
          unprocessable(
            conn,
            "no_active_placement",
            "Lot has no active placement — can't determine the cell to split on."
          )

        {:error, :ambiguous_placement} ->
          unprocessable(
            conn,
            "ambiguous_placement",
            "Lot is split across multiple cells — can't auto-split. Move the lot into a single cell first."
          )

        {:error, {:illegal_transition, info}} ->
          unprocessable(
            conn,
            "illegal_transition",
            "Can't transition to #{info.kind} from #{info.from}."
          )

        {:error, :qc_adjustment_below_zero} ->
          unprocessable(
            conn,
            "qc_adjustment_below_zero",
            "The qty adjustment you typed would drop the lot's on-hand placement below zero. Check the measured qty before passing."
          )

        {:error, {:npd_validation_not_passed, current_status}} ->
          # R&D MO Output QC gate — NPD ProductValidation must reach
          # `passed` before PSP can accept the operator's pass. The FE
          # already disables the button; this covers the direct API
          # path + race conditions.
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{
            error: "npd_validation_not_passed",
            detail:
              "This lot is from an R&D trial/sample MO. The NPD product validation must reach 'passed' before Output QC can pass. Current status: #{current_status || "not started"}.",
            npd_validation_status: current_status
          })

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)

        {:error, reason} ->
          unprocessable(conn, "qc_sign_off_failed", inspect(reason))
      end
    else
      forbidden(conn, "Missing production.qc_output permission.")
    end
  end

  # GET /api/production/runs
  # Preflight-cleared MOs the production operator can start or finish.
  def runs(conn, _params) do
    actor = conn.assigns.current_user

    if RBAC.has_permission?(actor, "production.mo_execute") do
      entries = Production.list_production_runs(actor.company_id)
      json(conn, %{items: Enum.map(entries, &Payloads.production_run_entry/1)})
    else
      forbidden(conn, "Missing production.mo_execute permission.")
    end
  end

  # POST /api/production/manufacturing-orders/:id/start-production
  # Flips a preflight-cleared MO to in_progress + stamps actual_start.
  def start_production(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %ManufacturingOrder{} = mo ->
        if RBAC.has_permission?(actor, "production.mo_execute") do
          case Production.start_mo_production(actor, mo) do
            {:ok, updated} ->
              json(conn, %{mo: Payloads.manufacturing_order(updated)})

            {:error, {:invalid_status, current}} ->
              unprocessable(
                conn,
                "wrong_status",
                "MO is #{current}; only scheduled MOs can be started."
              )

            {:error, :pickup_not_completed} ->
              unprocessable(
                conn,
                "pickup_not_completed",
                "Warehouse pickup isn't done — picker needs to confirm transfer first."
              )

            {:error, :preflight_incomplete} ->
              unprocessable(
                conn,
                "preflight_incomplete",
                "Sign off every booking under Pre-production before starting."
              )

            {:error, %Ecto.Changeset{} = cs} ->
              changeset_error(conn, cs)
          end
        else
          forbidden(conn, "Missing production.mo_execute permission.")
        end
    end
  end

  # POST /api/production/manufacturing-orders/:id/finish-production
  # Body: %{
  #   "actual_finish" => ISO datetime (optional, defaults to now),
  #   "actual_start"  => ISO datetime (optional, override if Start was skipped),
  #   "quantity_produced" => string | number (required, >= 0)
  # }
  def finish_production(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    case Production.get_manufacturing_order(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %ManufacturingOrder{} = mo ->
        if RBAC.has_permission?(actor, "production.mo_execute") do
          opts = build_finish_opts(params)

          case Production.finish_mo_production(actor, mo, opts) do
            {:ok, updated} ->
              json(conn, %{mo: Payloads.manufacturing_order(updated)})

            {:error, {:invalid_status, current}} ->
              unprocessable(
                conn,
                "wrong_status",
                "MO is #{current}; Finish requires an in-progress run."
              )

            {:error, :bad_qty} ->
              unprocessable(
                conn,
                "bad_qty",
                "Produced quantity must be a non-negative number."
              )

            {:error, :bad_datetime} ->
              unprocessable(
                conn,
                "bad_datetime",
                "Date / time inputs must be valid ISO timestamps."
              )

            {:error, :finish_before_start} ->
              unprocessable(
                conn,
                "finish_before_start",
                "Finish time can't be earlier than start time."
              )

            {:error, :no_production_cell} ->
              unprocessable(
                conn,
                "no_production_cell",
                "MO has no production-feed cell — picker never confirmed transfer."
              )

            {:error, :missing_step_uuid} ->
              unprocessable(
                conn,
                "missing_step_uuid",
                "Each operation_time entry needs a step_uuid."
              )

            {:error, :operation_time_outside_run} ->
              unprocessable(
                conn,
                "operation_time_outside_run",
                "Operation times must fall between the MO's start and finish."
              )

            {:error, {:step_not_in_mo, uuid}} ->
              unprocessable(
                conn,
                "step_not_in_mo",
                "Step #{uuid} doesn't belong to this MO."
              )

            {:error, :bad_operation_times} ->
              unprocessable(
                conn,
                "bad_operation_times",
                "operation_times must be a list of step time entries."
              )

            {:error, :missing_packs} ->
              unprocessable(
                conn,
                "missing_packs",
                "At least one package must be recorded when finishing production."
              )

            {:error, :bad_pack_entry} ->
              unprocessable(
                conn,
                "bad_pack_entry",
                "Each pack must be a map with qty + dimensions."
              )

            {:error, {:bad_pack_field, field}} ->
              unprocessable(
                conn,
                "bad_pack_field",
                "Pack field `#{field}` must be a positive number."
              )

            {:error, {:pack_qty_mismatch, %{sum: sum, total: total}}} ->
              unprocessable(
                conn,
                "pack_qty_mismatch",
                "Pack quantities sum to #{Decimal.to_string(sum)} but produced quantity is #{Decimal.to_string(total)}."
              )

            {:error, %Ecto.Changeset{} = cs} ->
              changeset_error(conn, cs)
          end
        else
          forbidden(conn, "Missing production.mo_execute permission.")
        end
    end
  end

  defp build_finish_opts(params) do
    base =
      Enum.reduce(
        [{"actual_start", :actual_start}, {"actual_finish", :actual_finish}, {"quantity_produced", :quantity_produced}],
        [],
        fn {key, opt}, acc ->
          case Map.get(params, key) do
            nil -> acc
            val -> [{opt, val} | acc]
          end
        end
      )

    base =
      case Map.get(params, "operation_times") do
        list when is_list(list) -> [{:operation_times, list} | base]
        _ -> base
      end

    case Map.get(params, "packs") do
      list when is_list(list) -> [{:packs, list} | base]
      _ -> base
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

  defp unprocessable(conn, code, detail, extras \\ %{}) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(Errors.payload(code, detail, extras))
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
