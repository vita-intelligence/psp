defmodule Backend.OrderWizard do
  @moduledoc """
  Projects a customer order's full production-side lifecycle into a
  single snapshot the FE renders as a step-by-step wizard. Powers
  the "Wizard" tab on `/sales/orders/[uuid]`.

  Six phases, in order:

    1. `setup`              — CO draft. Add lines, pick customer.
    2. `approval`           — 2-tier ESIGN in progress (or awaiting
                              the operator's final Confirm tap).
    3. `production_planning`— CO confirmed; one MO needs creating
                              for each producible line.
    4. `awaiting_ingredients`— MOs exist but some bookings are
                              placeholders against still-open POs.
    5. `in_production`      — All bookings are real; MOs are being
                              scheduled / run on the floor.
    6. `closeout`           — All MOs `completed` but the produced
                              lots haven't been moved back to
                              warehouse storage yet (still sitting
                              in the production-feed cell).
    7. `ready_to_dispatch`  — All output lots are in regular /
                              dispatch cells. This is the terminal
                              state for V1 (no dispatch module yet).
    *. `cancelled`          — Terminal short-circuit for
                              `customer_orders.status = "cancelled"`.

  The snapshot also surfaces **blockers** (issues that don't move
  the phase but warrant operator attention — e.g. a broken booking
  on an in-progress MO) and a **timeline** of state changes already
  applied so the operator can read backwards.

  Read-only. Every write is the existing context function the
  `next_action.primary_cta` deep-links to.
  """

  import Ecto.Query, warn: false

  alias Backend.CustomerInvoices.CustomerInvoice
  alias Backend.CustomerOrders.{CustomerOrder, CustomerOrderApproval, CustomerOrderLine}
  alias Backend.Production
  alias Backend.Production.{BOM, ManufacturingOrder}
  alias Backend.Purchasing.PurchaseOrder
  alias Backend.Repo
  alias Backend.Stock.Lot

  @phases [:setup, :approval, :production_planning, :awaiting_ingredients,
           :in_production, :closeout, :final_release, :awaiting_routing,
           :ready_to_dispatch]
  @total_phases length(@phases)

  @doc """
  Broadcast a "wizard refresh" hint to every subscriber of the given
  CO's wizard channel. Safe to call from any context that flips state
  the wizard projects over — the FE simply re-fetches its snapshot
  when it receives the event.

  Pass the CO directly when you have it; otherwise pass an
  `manufacturing_order_id`, `purchase_order_id`, or `customer_order_id`
  and we resolve.
  """
  def notify_co_changed(%CustomerOrder{uuid: uuid}) when not is_nil(uuid) do
    BackendWeb.WizardChannel.broadcast_changed(uuid)
  end

  def notify_co_changed(co_id) when is_integer(co_id) do
    case Repo.get(CustomerOrder, co_id) do
      %{uuid: uuid} -> BackendWeb.WizardChannel.broadcast_changed(uuid)
      _ -> :ok
    end
  end

  def notify_co_changed(_), do: :ok

  @doc """
  Resolve from an MO id → the customer-order line → the CO, and
  notify. Used by Production context functions that don't directly
  hold a CO reference.
  """
  def notify_via_mo(%ManufacturingOrder{customer_order_line_id: nil}), do: :ok

  def notify_via_mo(%ManufacturingOrder{customer_order_line_id: line_id}) do
    line = Repo.get(CustomerOrderLine, line_id)

    if line && line.customer_order_id do
      notify_co_changed(line.customer_order_id)
    end

    :ok
  end

  def notify_via_mo(mo_id) when is_integer(mo_id) do
    case Repo.get(ManufacturingOrder, mo_id) do
      %ManufacturingOrder{} = mo -> notify_via_mo(mo)
      _ -> :ok
    end
  end

  def notify_via_mo(_), do: :ok

  @doc """
  Compact summary of every "in-flight" CO in the company — anything
  that isn't `cancelled`. Drafts ARE included so the Setup column
  of the pipeline shows half-built orders that need finishing.
  Cancelled COs belong in an archive view, not the live board.
  Each row carries enough state to render the phase badge, the
  next-action title, and a blocker chip.

  Returns:
    `[%{customer_order, phase, next_action_title, blocker_count,
        line_count, mo_count, has_placeholder_bookings,
        has_output_at_production_feed}, ...]`

  Sort order: phase index ASC (so "Setup" items rise to the top of
  the operator's attention before things that are quietly
  in-production), then due date ASC, then code ASC.
  """
  def list_active(company_id) when is_integer(company_id) do
    from(co in CustomerOrder,
      where: co.company_id == ^company_id,
      where: co.status != "cancelled",
      order_by: [asc: co.id]
    )
    |> Repo.all()
    |> Enum.map(&summary_for/1)
    |> Enum.sort_by(&{&1.phase.index, &1.customer_order.id})
  end

  defp summary_for(%CustomerOrder{} = co) do
    snap = snapshot(co)

    %{
      customer_order: snap.customer_order,
      phase: snap.phase,
      next_action_title: snap.next_action && snap.next_action.title,
      next_action_detail: snap.next_action && snap.next_action.detail,
      next_action_cta: snap.next_action && snap.next_action.primary_cta,
      blocker_count: length(snap.blockers),
      line_count: length(snap.lines),
      mo_count: length(snap.mos),
      lines_awaiting_mo:
        Enum.count(snap.lines, fn line ->
          line.needs_mo? and is_nil(line.primary_mo)
        end),
      mos_with_placeholders:
        Enum.count(snap.mos, & &1.has_placeholder_bookings?),
      # Split the placeholder count by PO state so the kanban chip
      # can tell the planner whether the next move is "push the PO
      # out the door" (unsent) vs. "wait for delivery" (sent).
      mos_awaiting_po_send:
        Enum.count(snap.mos, & &1.has_unsent_placeholder_po?),
      mos_awaiting_delivery:
        Enum.count(snap.mos, fn mo ->
          mo.has_sent_placeholder_po? and not mo.has_unsent_placeholder_po?
        end),
      mos_in_production:
        Enum.count(snap.mos, &(&1.status in ["scheduled", "in_progress"])),
      mos_awaiting_closeout:
        Enum.count(snap.mos, & &1.has_output_at_production_feed?)
    }
  end

  @doc """
  Build the snapshot. Caller supplies a preloaded CO struct; we top
  up whichever associations we need.
  """
  def snapshot(%CustomerOrder{} = co) do
    co = preload_co(co)
    lines = co.lines

    line_states = Enum.map(lines, &line_state(co, &1))

    # all_mos is the flattened chain — each line's primary +
    # secondary MOs PLUS every child MO in the parent/child tree.
    # Phase derivation and blocker rollups need to see the full
    # chain or they'll declare "ingredients ready" while a
    # sub-assembly MO is still in draft.
    all_mos =
      line_states
      |> Enum.flat_map(& &1.mos)
      |> Enum.flat_map(&flatten_mo_tree/1)

    blockers = compute_blockers(co, line_states, all_mos)
    phase = derive_phase(co, line_states, all_mos)
    approvals = signers_for(co)
    invoices = invoices_for(co)

    %{
      customer_order: co,
      phase: phase_payload(phase),
      next_action:
        next_action_for(phase, co, line_states, all_mos, approvals),
      blockers: blockers,
      lines: line_states,
      mos: all_mos,
      open_pos: open_pos_for(all_mos),
      invoices: invoices,
      timeline: timeline(co, all_mos, approvals),
      signers: approvals
    }
  end

  # Surface invoice presence on the CO so the wizard can flag
  # "confirmed but no invoice yet". Invoicing is intentionally
  # decoupled from production state (some COs ship without an
  # invoice; some are invoiced up front as pro-forma), so this is
  # advisory — never a blocker.
  defp invoices_for(%CustomerOrder{id: cid}) do
    from(i in CustomerInvoice,
      where: i.customer_order_id == ^cid,
      where: i.status != "cancelled",
      order_by: [asc: i.id]
    )
    |> Repo.all()
  end

  # Pull the approval signature rows (approver + director) attached to
  # the CO so the next-action card can name who signed each tier and
  # who's still expected to sign.
  defp signers_for(%CustomerOrder{id: cid}) do
    rows =
      from(a in CustomerOrderApproval,
        where: a.customer_order_id == ^cid,
        preload: [:signed_by]
      )
      |> Repo.all()

    %{
      approver: Enum.find(rows, &(&1.kind == "approver")),
      director: Enum.find(rows, &(&1.kind == "director"))
    }
  end

  # ----- phase derivation ----------------------------------------

  defp derive_phase(%CustomerOrder{status: "cancelled"}, _, _), do: :cancelled

  defp derive_phase(%CustomerOrder{status: "draft"}, _line_states, _mos), do: :setup

  defp derive_phase(
         %CustomerOrder{status: s},
         _line_states,
         _mos
       )
       when s in ["pending_approver", "pending_director", "approved"],
       do: :approval

  defp derive_phase(%CustomerOrder{status: "confirmed"}, line_states, mos) do
    cond do
      # A line is still waiting on an MO being created at all.
      Enum.any?(line_states, &(&1.needs_mo? and is_nil(&1.primary_mo))) ->
        :production_planning

      # Stay in planning until EVERY MO is fully sorted by the planner:
      # signed off (status ≥ approved) AND no broken bookings. Once
      # signed, planning is "done from the planner's side" — what's
      # missing is goods, not decisions.
      not Enum.all?(mos, & &1.is_fully_sorted?) ->
        :production_planning

      # Awaiting ingredients = planner signed off but goods aren't on
      # hand yet. Either there's a placeholder reservation against an
      # in-flight PO (waiting for delivery), OR there's a BOM line not
      # yet booked at all (waiting for procurement to even create the
      # PO). Both keep the order from advancing to production.
      Enum.any?(mos, &(&1.has_placeholder_bookings? or &1.under_booked_count > 0)) ->
        :awaiting_ingredients

      not Enum.all?(mos, &(&1.status == "completed")) ->
        :in_production

      Enum.any?(mos, & &1.has_output_at_production_feed?) ->
        :closeout

      # Any awaiting-release output owes a Final Product Release
      # ceremony (BRCGS Issue 9 § 5.6) before the order can be
      # considered ready to dispatch. Distinct phase so operators see
      # it as its own pipeline block, not folded into closeout.
      Enum.any?(mos, &(Map.get(&1, :output_awaiting_release_count, 0) > 0)) ->
        :final_release

      # Released lots now sit in finished_quarantine waiting for the
      # operator to answer "3PL storage or direct shipment?" per lot.
      # Records the answer as a lifecycle event on the lot + flips
      # ownership_kind to bailee when the choice is 3PL (customer
      # takes ownership, we hold as bailee — BRCGS § 4.4 segregation +
      # § 5.6 handoff). Until every released lot has been routed the
      # order can't advance to ready-to-dispatch.
      Enum.any?(mos, &(Map.get(&1, :output_needs_routing_count, 0) > 0)) ->
        :awaiting_routing

      true ->
        :ready_to_dispatch
    end
  end

  defp phase_payload(phase) do
    index = Enum.find_index(@phases, &(&1 == phase)) || -1

    %{
      key: phase,
      label: phase_label(phase),
      index: index,
      total: @total_phases,
      is_terminal: phase in [:ready_to_dispatch, :cancelled]
    }
  end

  defp phase_label(:setup), do: "Order setup"
  defp phase_label(:approval), do: "Approval"
  defp phase_label(:production_planning), do: "Production planning"
  defp phase_label(:awaiting_ingredients), do: "Awaiting ingredients"
  defp phase_label(:in_production), do: "In production"
  defp phase_label(:closeout), do: "Closeout"
  defp phase_label(:final_release), do: "Release"
  defp phase_label(:awaiting_routing), do: "Routing"
  defp phase_label(:ready_to_dispatch), do: "Ready to dispatch"
  defp phase_label(:cancelled), do: "Cancelled"

  # ----- next_action derivation ----------------------------------

  defp next_action_for(:cancelled, co, _, _, _) do
    %{
      code: "cancelled",
      title: "This order was cancelled.",
      detail:
        co.cancellation_reason && "Reason: #{co.cancellation_reason}",
      primary_cta: nil,
      secondary_ctas: []
    }
  end

  defp next_action_for(:setup, co, _line_states, _mos, _signers) do
    cond do
      co.lines == [] ->
        %{
          code: "add_lines",
          title: "Add at least one line to the order.",
          detail:
            "An empty draft can't be submitted. Open the order to pick the items the customer wants — the lines editor lives on the order detail page.",
          primary_cta: %{
            label: "Add lines",
            kind: "link",
            href: "/sales/orders/#{co.uuid}"
          },
          secondary_ctas: []
        }

      not customer_effectively_approved?(co) ->
        %{
          code: "approve_customer",
          title: "Customer is not approved.",
          detail:
            "Submitting a CO needs an effectively-approved customer. Open the customer and finish the qualification + approval.",
          primary_cta: %{
            label: "Open customer",
            kind: "link",
            href:
              co.customer && "/sales/customers/#{co.customer.uuid}"
          },
          secondary_ctas: []
        }

      true ->
        %{
          code: "submit_co",
          title: "Submit for approval.",
          detail:
            "All checks pass. Click Submit to start the 2-tier signature flow (approver → director → confirmed).",
          primary_cta: %{
            label: "Submit for approval",
            kind: "action",
            action: "submit",
            href:
              "/sales/orders/#{co.uuid}"
          },
          secondary_ctas: []
        }
    end
  end

  defp next_action_for(:approval, co, _line_states, _mos, signers) do
    submitter = co.submitted_by && co.submitted_by.name
    creator = co.created_by && co.created_by.name

    case co.status do
      "pending_approver" ->
        # Author of the CO can't sign as approver — segregation of
        # duties. Surface the author so the worker knows *they* can't
        # be the signer.
        %{
          code: "awaiting_approver",
          title: "Awaiting approver signature.",
          detail:
            author_note(submitter || creator, "approver") <>
              " Anyone with the customer-orders.approve permission (other than the author) opens this project and clicks Approve.",
          primary_cta: %{
            label: "Approve as approver",
            kind: "action",
            action: "sign_approver"
          },
          secondary_ctas: []
        }

      "pending_director" ->
        approver_name =
          (signers.approver && signers.approver.signed_by &&
             signers.approver.signed_by.name) || "the approver"

        %{
          code: "awaiting_director",
          title: "Awaiting director signature.",
          detail:
            "#{approver_name} signed as approver. A director (different from the approver, and not the author) signs to finalise the order.",
          primary_cta: %{
            label: "Approve as director",
            kind: "action",
            action: "sign_director"
          },
          secondary_ctas: []
        }

      "approved" ->
        %{
          code: "mark_confirmed",
          title: "Click Confirm to release for production.",
          detail:
            "Both signatures done. Confirming the order unlocks MO creation and locks the lines.",
          primary_cta: %{
            label: "Mark confirmed",
            kind: "action",
            action: "confirm"
          },
          secondary_ctas: []
        }
    end
  end

  defp author_note(nil, _), do: ""

  defp author_note(name, "approver"),
    do: "#{name} authored this order, so they can't sign as approver."

  defp next_action_for(:production_planning, co, line_states, mos, _signers) do
    missing = Enum.filter(line_states, &(&1.needs_mo? and is_nil(&1.primary_mo)))

    case missing do
      [] ->
        # Every line has its primary MO, but the strict phase gate
        # keeps us in planning until every MO in the parent/child
        # chain is fully sorted (approved + no unresolved shortages).
        # Surface the first unfinished MO so the operator knows
        # exactly where to click.
        unfinished = Enum.filter(mos, &(not &1.is_fully_sorted?))

        case unfinished do
          [] ->
            %{
              code: "next_phase",
              title: "All MOs are sorted — moving to ingredients.",
              detail: nil,
              primary_cta: nil,
              secondary_ctas: []
            }

          [first | _] ->
            {title, detail} = unfinished_mo_reason(first, length(unfinished))

            %{
              code: "finish_sorting_mo",
              title: title,
              detail: detail,
              primary_cta: %{
                label: "Open MO #{first.code}",
                kind: "link",
                href: "/production/manufacturing-orders/#{first.uuid}"
              },
              secondary_ctas: []
            }
        end

      [only] ->
        # Single missing line — inline action is unambiguous.
        boms = only.available_boms || []

        cta =
          case boms do
            [bom] ->
              %{
                label: "Create MO using BOM #{bom.code || bom.name}",
                kind: "action",
                action: "create_mo_for_line",
                line_uuid: only.uuid,
                bom_id: bom.id,
                href: "/sales/orders/#{co.uuid}/wizard"
              }

            [_, _ | _] ->
              %{
                label: "Pick a BOM and create MO",
                kind: "action",
                action: "create_mo_for_line",
                line_uuid: only.uuid,
                href: "/sales/orders/#{co.uuid}/wizard"
              }

            [] ->
              %{
                label: "Build a BOM for #{only.item_name}",
                kind: "link",
                href: "/production/boms"
              }
          end

        detail =
          case boms do
            [] ->
              "No active BOM exists for #{only.item_name}. Build one before the MO can be created."

            [bom] ->
              line_summary(only) <>
                ". This item has one active BOM (#{bom.name}); we'll use it automatically."

            [_, _ | _] ->
              line_summary(only) <>
                ". This item has #{length(boms)} active BOMs — pick which one this MO should use."
          end

        %{
          code: "create_mo",
          title: "Create the manufacturing order for #{only.item_name}.",
          detail: detail,
          primary_cta: cta,
          secondary_ctas: []
        }

      multiple ->
        # Multiple lines waiting on MOs — don't duplicate the per-line
        # buttons that already live in the Lines section. Send the
        # operator there with a single clear CTA. Inline buttons in the
        # Lines table are the canonical workflow.
        count = length(multiple)

        %{
          code: "create_mos",
          title: "Create one manufacturing order per line — #{count} to go.",
          detail:
            "Each line below needs its own MO. Open the Lines section and hit Create on each row — the system picks the active BOM automatically when there's only one.",
          primary_cta: %{
            label: "Go to lines",
            kind: "scroll_to",
            target: "[data-phase=\"production_planning\"]"
          },
          secondary_ctas: []
        }
    end
  end

  defp next_action_for(:awaiting_ingredients, co, _line_states, mos, _signers) do
    # Phase fires when at least one MO either has placeholder
    # bookings (POs exist, awaiting delivery) OR has under-booked
    # BOM lines (planner needs to allocate or hand to procurement).
    # The "next step" depends on which one:
    #
    #  1. Shortages exist on an MO that hasn't fired Request
    #     purchases yet → planner action.
    #  2. Shortages exist on an MO that DID fire Request purchases
    #     but no PO has been created → procurement action.
    #  3. Placeholder bookings exist (POs are out) → chase the PO.

    needs_request =
      Enum.filter(mos, fn mo ->
        mo.under_booked_count > 0 and is_nil(mo.purchasing_requested_at)
      end)

    awaiting_po_creation =
      Enum.filter(mos, fn mo ->
        mo.under_booked_count > 0 and not is_nil(mo.purchasing_requested_at)
      end)

    cond do
      needs_request != [] ->
        target = List.first(needs_request)

        %{
          code: "request_purchases",
          title: "Click Request purchases on MO #{target.code}.",
          detail:
            "This MO has unbooked BOM lines. Until you request purchases, the shortages page won't pick it up and procurement can't act.",
          primary_cta: %{
            label: "Request purchases for MO #{target.code}",
            kind: "action",
            action: "request_purchases",
            mo_uuid: target.uuid
          },
          secondary_ctas:
            for mo <- Enum.drop(needs_request, 1) do
              %{
                label: "Request purchases for MO #{mo.code}",
                kind: "action",
                action: "request_purchases",
                mo_uuid: mo.uuid
              }
            end
        }

      awaiting_po_creation != [] ->
        codes = awaiting_po_creation |> Enum.map(& &1.code) |> Enum.join(", ")
        count = length(awaiting_po_creation)

        %{
          code: "create_pos",
          title:
            "Procurement needs to create #{count} purchase order#{if count == 1, do: "", else: "s"}.",
          detail:
            "Shortages on #{codes} have been sent to procurement, but no POs have been opened yet. Open the shortages page and create the POs (reserve them against these MOs) so production can move forward.",
          primary_cta: %{
            label: "Open shortages page",
            kind: "link",
            href: "/procurement/shortages"
          },
          secondary_ctas: []
        }

      true ->
        chase_open_pos(co, mos)
    end
  end

  defp chase_open_pos(co, mos) do
    blocked_mos = Enum.filter(mos, & &1.has_placeholder_bookings?)
    po_uuids = blocked_mos |> Enum.flat_map(& &1.placeholder_po_uuids) |> Enum.uniq()

    # Pull the most-recent inspection uuid per PO via a subquery so the
    # awaiting-QC branch can deep-link straight at it. left_join + take
    # the latest by id covers re-opened inspections (rare) and the
    # common single-inspection case.
    latest_inspection =
      from(i in Backend.GoodsIn.Inspection,
        group_by: i.purchase_order_id,
        select: %{purchase_order_id: i.purchase_order_id, max_id: max(i.id)}
      )

    pos =
      from(po in PurchaseOrder,
        left_join: latest in subquery(latest_inspection),
        on: latest.purchase_order_id == po.id,
        left_join: insp in Backend.GoodsIn.Inspection,
        on: insp.id == latest.max_id,
        where: po.uuid in ^po_uuids,
        order_by: [asc: po.expected_delivery_date, asc: po.id],
        select: %{
          uuid: po.uuid,
          status: po.status,
          expected_delivery_date: po.expected_delivery_date,
          id: po.id,
          inspection_uuid: insp.uuid
        }
      )
      |> Repo.all()

    case pos do
      [next_po | _] ->
        # Branch on PO status. A draft / pending-approval PO can't be
        # "chased" from the vendor — it hasn't even been sent yet.
        # An ordered / partially-received PO is what the vendor has;
        # that's what "chase" applies to. A `received` PO is awaiting
        # QC sign-off — the buttons jump straight at the inspection.
        copy = chase_po_copy(pos, next_po)

        %{
          code: "chase_po",
          title: copy.title,
          detail: copy.detail,
          primary_cta: %{
            label: copy.primary_label,
            kind: "link",
            href: copy.primary_href
          },
          secondary_ctas:
            [
              %{
                label: copy.send_label,
                kind: "send_to_device",
                href: copy.send_href
              }
            ] ++
              for po <- Enum.drop(pos, 1) do
                %{
                  label: secondary_po_label(po),
                  kind: "link",
                  href: secondary_po_href(po)
                }
              end,
          shortages_link: %{
            label: "Open shortages page",
            href: "/procurement/shortages"
          }
        }

      [] ->
        %{
          code: "request_purchases",
          title: "Some MOs still need purchasing requested.",
          detail:
            "Open each MO and click Request purchases so the shortages page picks them up.",
          primary_cta: %{
            label: "Open shortages page",
            kind: "link",
            href: "/procurement/shortages"
          },
          secondary_ctas: []
        }
    end
  end

  # Three buckets of PO state the planner cares about, in priority
  # order (the immediate blocker wins the messaging):
  #
  #   - Not sent yet (draft / pending_approver / pending_director /
  #     approved) → the planner / procurement needs to submit + sign
  #     it before the vendor sees anything.
  #   - In transit (ordered / partially_received) → vendor owes us
  #     goods; "chase" applies.
  #   - Awaiting QC (received) → goods are on site, QC inspection is
  #     the only thing between here and production. Different copy so
  #     the operator doesn't get told to "submit + sign it off" on a
  #     PO whose pallets are already on the dock.
  @sent_po_statuses ~w(ordered partially_received)
  @awaiting_qc_po_statuses ~w(received)
  defp chase_po_copy(pos, next_po) do
    not_sent =
      Enum.filter(
        pos,
        &(&1.status not in @sent_po_statuses and
            &1.status not in @awaiting_qc_po_statuses)
      )

    in_transit = Enum.filter(pos, &(&1.status in @sent_po_statuses))
    awaiting_qc = Enum.filter(pos, &(&1.status in @awaiting_qc_po_statuses))

    cond do
      not_sent != [] ->
        target = List.first(not_sent)
        count = length(not_sent)
        label_for_status = po_status_label(target.status)

        %{
          title:
            "#{count} purchase order#{if count == 1, do: "", else: "s"} not sent to the vendor yet.",
          detail:
            "PO ##{target.id} is #{label_for_status}. Submit + sign it off so the vendor receives the order — production can't start until the goods are at least on order.",
          primary_label: "Open PO ##{target.id}",
          primary_href: "/procurement/purchase-orders/#{target.uuid}",
          send_label: "Send PO ##{target.id} to device",
          send_href: "/m/incoming/#{target.uuid}"
        }

      in_transit != [] ->
        count = length(in_transit)

        %{
          title:
            "Awaiting #{count} purchase order#{if count == 1, do: "", else: "s"} from the vendor.",
          detail:
            "Next expected delivery: #{format_date(next_po.expected_delivery_date) || "no date set"}. Chase the vendor or update the expected date.",
          primary_label: "Open next PO",
          primary_href: "/procurement/purchase-orders/#{next_po.uuid}",
          send_label: "Send PO ##{next_po.id} to device",
          send_href: "/m/incoming/#{next_po.uuid}"
        }

      awaiting_qc != [] ->
        # Goods are on site — the operator's next action is the QC
        # inspection, not the desktop PO page. Buttons deep-link at
        # the inspection (desktop + mobile) so a one-tap handoff lands
        # the QC team exactly where they need to sign off.
        target = List.first(awaiting_qc)
        count = length(awaiting_qc)
        insp_uuid = target.inspection_uuid

        primary =
          if insp_uuid do
            %{
              label: "Open inspection",
              href: "/procurement/inspections/#{insp_uuid}"
            }
          else
            %{
              label: "Open PO ##{target.id}",
              href: "/procurement/purchase-orders/#{target.uuid}"
            }
          end

        send =
          if insp_uuid do
            %{
              label: "Send inspection to device",
              href: "/m/inspections/#{insp_uuid}"
            }
          else
            %{
              label: "Send PO ##{target.id} to device",
              href: "/m/incoming/#{target.uuid}"
            }
          end

        %{
          title:
            "Goods received — awaiting QC on #{count} purchase order#{if count == 1, do: "", else: "s"}.",
          detail:
            "PO ##{target.id} is fully received. The quality team needs to sign off the goods-in inspection before the bookings become real and production can pull stock.",
          primary_label: primary.label,
          primary_href: primary.href,
          send_label: send.label,
          send_href: send.href
        }

      true ->
        # Defensive — shouldn't reach here since pos is non-empty.
        %{
          title: "Awaiting purchase orders.",
          detail: nil,
          primary_label: "Open next PO",
          primary_href: "/procurement/purchase-orders/#{next_po.uuid}",
          send_label: "Send PO ##{next_po.id} to device",
          send_href: "/m/incoming/#{next_po.uuid}"
        }
    end
  end

  # Per-PO secondary link — for the awaiting-QC branch we link at the
  # inspection when one exists so the planner can drill into either
  # PO's QC at a tap. Falls back to the desktop PO page when no
  # inspection has been spun up yet (rare).
  defp secondary_po_label(po) do
    cond do
      po.status in @awaiting_qc_po_statuses and po.inspection_uuid ->
        "Open inspection (PO ##{po.id})"

      true ->
        "Open PO ##{po.id}"
    end
  end

  defp secondary_po_href(po) do
    cond do
      po.status in @awaiting_qc_po_statuses and po.inspection_uuid ->
        "/procurement/inspections/#{po.inspection_uuid}"

      true ->
        "/procurement/purchase-orders/#{po.uuid}"
    end
  end

  defp po_status_label("draft"), do: "still in draft"
  defp po_status_label("pending_approver"), do: "waiting on approver sign-off"
  defp po_status_label("pending_director"), do: "waiting on director sign-off"
  defp po_status_label("approved"), do: "approved but not marked ordered yet"
  defp po_status_label("ordered"), do: "ordered"
  defp po_status_label("partially_received"), do: "partially received"
  defp po_status_label("received"), do: "fully received"
  defp po_status_label("cancelled"), do: "cancelled"
  defp po_status_label(other), do: other

  defp next_action_for(:in_production, _co, _line_states, mos, _signers) do
    # Pending work = anything not yet completed PLUS completed MOs
    # that still owe output-QC sign-off or whose outputs / leftovers
    # haven't been pulled back to warehouse. Both surface to the
    # "Do this next" punch-list so the room can see the whole tail
    # of the production chain, not just the part that's actively
    # running.
    active = Enum.filter(mos, &mo_has_pending_work?/1)

    candidate =
      Enum.min_by(active, &mo_priority/1, fn -> List.first(active) end)

    {title, cta} = production_step_cta(candidate)

    %{
      code: "advance_mo",
      title: title,
      detail:
        candidate.broken_booking_count > 0 &&
          "Heads up: #{candidate.broken_booking_count} broken booking(s). Fix before running.",
      primary_cta: cta,
      secondary_ctas:
        active
        |> Enum.reject(&(&1.id == candidate.id))
        |> Enum.sort_by(&mo_priority/1)
        |> Enum.map(fn mo ->
          {step_title, step_cta} = production_step_cta(mo)
          # Keep the action verb on `label` (it's the button text);
          # surface the full sentence on `description` so the FE can
          # render the row's title separately from the button.
          step_cta
          |> Map.put(:label, "MO #{mo.code} — #{step_cta.label}")
          |> Map.put(:description, step_title)
        end),
      scheduler_link: %{
        label: "Open scheduler",
        href: "/production/schedule"
      }
    }
  end

  # Each MO sub-stage maps to a specific action the operator needs
  # to take. "scheduled" is split three ways because a single
  # "scheduled" MO can be awaiting pickup, picking, or awaiting
  # preflight — three distinct handoffs with three distinct mobile
  # pages. Falling back to "Start MO on the floor" + /m/preflight
  # for all three (the old behaviour) mislabeled the work and sent
  # operators to the wrong screen.
  defp production_step_cta(mo) do
    case mo.status do
      "draft" ->
        {"Prepare MO #{mo.code}.",
         %{
           label: "Prepare",
           kind: "action",
           action: "prepare_mo",
           mo_uuid: mo.uuid
         }}

      "prepared" ->
        {"Approve MO #{mo.code} (second signature).",
         %{
           label: "Approve",
           kind: "action",
           action: "approve_mo",
           mo_uuid: mo.uuid
         }}

      "approved" ->
        # Include the MO code in the button label so a planner scanning
        # the primary CTA sees exactly WHICH MO the click will schedule
        # — otherwise \"Open scheduler\" reads as a generic launcher and
        # the planner has scheduled the wrong MO on a fast click.
        {"Schedule MO #{mo.code} on the calendar.",
         %{
           label: "Open scheduler for MO #{mo.code}",
           kind: "link",
           href: "/production/schedule?mo=#{mo.uuid}"
         }}

      "scheduled" ->
        scheduled_step_cta(mo)

      "in_progress" ->
        {"MO #{mo.code} is running — finish on the floor.",
         %{
           label: "Open run",
           kind: "link",
           href: "/production/runs/#{mo.uuid}"
         }}

      "completed" ->
        completed_step_cta(mo)

      _ ->
        {"Open MO #{mo.code}.",
         %{
           label: "Open MO",
           kind: "link",
           href: "/production/manufacturing-orders/#{mo.uuid}"
         }}
    end
  end

  # Split a `completed` MO by the closeout sub-stage. STRICT order:
  # QC sign-off → booking closeout → warehouse return → Final Product
  # Release. Mirrors the FE `deriveMoLiveStage` so the wizard's primary
  # CTA and the per-MO card always agree on the SINGLE next step.
  defp completed_step_cta(mo) do
    cond do
      Map.get(mo, :output_qc_pending_count, 0) > 0 ->
        {"Quality-check MO #{mo.code} outputs at the production-feed cell.",
         %{
           label: "Open output QC",
           kind: "link",
           href: "/production/output-qc"
         }}

      Map.get(mo, :bookings_closeout_pending_count, 0) > 0 ->
        {"Closeout MO #{mo.code} — record consumed qty + route leftover ingredients.",
         %{
           label: "Send closeout to device",
           kind: "send_to_device",
           href: "/m/closeout/#{mo.uuid}",
           mo_uuid: mo.uuid
         }}

      Map.get(mo, :has_output_at_production_feed?) == true ->
        {"Return MO #{mo.code} outputs from the production-feed cell to warehouse.",
         %{
           label: "Send return-pickup to device",
           kind: "send_to_device",
           href: "/m/return-pickup",
           mo_uuid: mo.uuid
         }}

      true ->
        {"MO #{mo.code} closed out.",
         %{
           label: "Open MO",
           kind: "link",
           href: "/production/manufacturing-orders/#{mo.uuid}"
         }}
    end
  end

  # Split a "scheduled" MO by pickup + preflight state. Mirrors the
  # FE `deriveMoLiveStage` logic so the wizard's primary CTA and the
  # per-MO card always agree on what comes next.
  defp scheduled_step_cta(mo) do
    cond do
      is_nil(Map.get(mo, :pickup_started_at)) and is_nil(Map.get(mo, :pickup_completed_at)) ->
        {"Pick up MO #{mo.code} from warehouse.",
         %{
           label: "Send pickup to device",
           kind: "send_to_device",
           href: "/m/pickup/#{mo.uuid}",
           mo_uuid: mo.uuid
         }}

      not is_nil(Map.get(mo, :pickup_started_at)) and is_nil(Map.get(mo, :pickup_completed_at)) ->
        actor =
          case Map.get(mo, :pickup_started_by_name) do
            name when is_binary(name) and name != "" -> " (#{name} on the floor)"
            _ -> ""
          end

        {"Picking in progress for MO #{mo.code}#{actor}.",
         %{
           label: "Open pickup on device",
           kind: "send_to_device",
           href: "/m/pickup/#{mo.uuid}",
           mo_uuid: mo.uuid
         }}

      # Pickup done + every booking signed off — operator can flip
      # the MO to in_progress. No mobile run page yet, so the CTA
      # links to the desktop run page where Start lives.
      Map.get(mo, :preflight_complete?) == true ->
        {"Start MO #{mo.code} on the floor.",
         %{
           label: "Open run",
           kind: "link",
           href: "/production/runs/#{mo.uuid}"
         }}

      true ->
        {"Preflight check MO #{mo.code} on the production-feed cell.",
         %{
           label: "Send preflight to device",
           kind: "send_to_device",
           href: "/m/preflight/#{mo.uuid}",
           mo_uuid: mo.uuid
         }}
    end
  end

  defp next_action_for(:closeout, _co, _line_states, mos, _signers) do
    # Every completed MO that still has post-run work — output QC or
    # warehouse return. Order: QC pending first (blocks every other
    # step), then warehouse fetch. Sort matches the per-MO card stage
    # ordering so the wizard's panel and the cards agree on priority.
    pending = Enum.filter(mos, &mo_has_pending_work?/1)
    target = List.first(pending)
    {title, cta} = completed_step_cta(target)

    %{
      code: "run_closeout",
      title: title,
      detail:
        "Production finished. Every output lot needs an output-QC verdict before closeout can be recorded; once QC clears the batch the warehouse picker walks outputs + leftovers back from the production-feed cell.",
      primary_cta: cta,
      secondary_ctas:
        pending
        |> Enum.drop(1)
        |> Enum.map(fn mo ->
          {step_title, step_cta} = completed_step_cta(mo)

          step_cta
          |> Map.put(:label, "MO #{mo.code} — #{step_cta.label}")
          |> Map.put(:description, step_title)
        end)
    }
  end

  defp next_action_for(:final_release, _co, _line_states, mos, _signers) do
    # STRICT ORDER: warehouse move FIRST (physical segregation into
    # finished_quarantine), THEN QA sign-off. Attempting the ceremony
    # while the lot's on general shelving hard-blocks at the form
    # entry (BRCGS Issue 9 § 5.6 + § 4.4), so the wizard must not
    # propose it until the move has landed.
    move_needed_mos =
      Enum.filter(
        mos,
        &(Map.get(&1, :output_release_move_needed_count, 0) > 0)
      )

    ready_mos =
      Enum.filter(mos, &(Map.get(&1, :output_release_ready_count, 0) > 0))

    cond do
      move_needed_mos != [] ->
        final_release_move_needed_action(move_needed_mos)

      ready_mos != [] ->
        final_release_ready_action(ready_mos)

      true ->
        %{
          code: "final_release",
          title: "Finished product awaiting QA sign-off (BRCGS § 5.6).",
          detail:
            "Every finished lot on this order still owes a Final Product Release ceremony.",
          primary_cta: %{
            label: "Open release queue",
            kind: "link",
            href: "/production/final-releases"
          },
          secondary_ctas: []
        }
    end
  end

  defp final_release_move_needed_action(mos) do
    target = List.first(mos)

    move_lot_count =
      Enum.reduce(mos, 0, fn mo, acc ->
        acc + Map.get(mo, :output_release_move_needed_count, 0)
      end)

    ready_lot_count =
      Enum.reduce(mos, 0, fn mo, acc ->
        acc + Map.get(mo, :output_release_ready_count, 0)
      end)

    %{
      code: "final_release_move",
      title:
        "Move #{move_lot_count} finished lot#{plural_s(move_lot_count)} to finished-quarantine (BRCGS § 5.6).",
      detail:
        "The lot#{plural_s(move_lot_count)} still on general shelving can't be released until the warehouse team scans #{if move_lot_count == 1, do: "it", else: "them"} into a finished-quarantine cell (standard scan-lot → scan-cell → photo procedure). Once the move records a Stock.Movement with photo evidence, the QA release form unblocks.#{if ready_lot_count > 0, do: " (#{ready_lot_count} other lot#{plural_s(ready_lot_count)} already in the release bay — release those separately.)", else: ""}",
      # Push the target to a paired mobile device — the move flow
      # only exists on the phone (needs the camera for the required
      # photo). Opening /m/putaway in the laptop browser is
      # useless.
      primary_cta: %{
        label: "Send put-away to phone",
        kind: "send_to_device",
        href: "/m/putaway",
        mo_uuid: target && Map.get(target, :uuid)
      },
      secondary_ctas:
        mos
        |> Enum.drop(1)
        |> Enum.map(fn mo ->
          %{
            label: "MO #{mo.code} — send put-away to phone",
            kind: "send_to_device",
            href: "/m/putaway",
            mo_uuid: mo.uuid,
            description:
              "Warehouse picker scans the output lot into a finished-quarantine cell."
          }
        end)
    }
  end

  defp final_release_ready_action(mos) do
    target = List.first(mos)

    target_lot_uuid =
      case target && Map.get(target, :output_release_ready_lot_uuids, []) do
        [uuid | _] when is_binary(uuid) -> uuid
        _ -> nil
      end

    href =
      if target_lot_uuid,
        do: "/production/final-releases/#{target_lot_uuid}",
        else: "/production/final-releases"

    %{
      code: "final_release",
      title:
        if(target,
          do: "QA sign-off for MO #{target.code} finished product (BRCGS § 5.6).",
          else: "Finished product awaiting QA sign-off (BRCGS § 5.6)."
        ),
      detail:
        "Everything's produced, closed out, and parked in finished-quarantine — QA can now attach evidence, collect two signatures, and Release. CoA + BMR + micro report + label proof required.",
      primary_cta: %{
        label: "Open Final Product Release",
        kind: "link",
        href: href
      },
      secondary_ctas:
        mos
        |> Enum.drop(1)
        |> Enum.map(fn mo ->
          lot_uuid =
            case Map.get(mo, :output_release_ready_lot_uuids, []) do
              [u | _] when is_binary(u) -> u
              _ -> nil
            end

          %{
            label: "MO #{mo.code} — release",
            kind: "link",
            href:
              if(lot_uuid,
                do: "/production/final-releases/#{lot_uuid}",
                else: "/production/final-releases"
              ),
            description:
              "Attach evidence + collect two signatures on the awaiting-release output."
          }
        end)
    }
  end

  defp plural_s(1), do: ""
  defp plural_s(_), do: "s"

  defp next_action_for(:awaiting_routing, co, _line_states, mos, _signers) do
    routing_mos =
      Enum.filter(mos, &(Map.get(&1, :output_needs_routing_count, 0) > 0))

    lot_count =
      Enum.reduce(routing_mos, 0, fn mo, acc ->
        acc + Map.get(mo, :output_needs_routing_count, 0)
      end)

    target = List.first(routing_mos)

    target_lot_uuid =
      case target && Map.get(target, :output_needs_routing_lot_uuids, []) do
        [uuid | _] when is_binary(uuid) -> uuid
        _ -> nil
      end

    href =
      if target_lot_uuid,
        do: "/production/final-releases/#{target_lot_uuid}",
        else: "/customer-orders/#{co.uuid}"

    %{
      code: "route_released_lots",
      title:
        "Route #{lot_count} released lot#{plural_s(lot_count)}: 3PL storage or direct shipment.",
      detail:
        "QA cleared these for handoff — pick the next stop per lot. 3PL storage flips ownership to the customer (we hold as bailee, m³-per-day rate accrues from the routing timestamp). Direct shipment moves the lot to a dispatch cell for pickup. Capacity is checked before we accept the choice; you'll see the free m³ for each purpose inline.",
      primary_cta: %{
        label: "Open routing step",
        kind: "link",
        href: href
      },
      secondary_ctas:
        routing_mos
        |> Enum.drop(1)
        |> Enum.map(fn mo ->
          lot_uuid =
            case Map.get(mo, :output_needs_routing_lot_uuids, []) do
              [u | _] when is_binary(u) -> u
              _ -> nil
            end

          %{
            label: "MO #{mo.code} — route lots",
            kind: "link",
            href:
              if(lot_uuid,
                do: "/production/final-releases/#{lot_uuid}",
                else: "/customer-orders/#{co.uuid}"
              ),
            description:
              "Choose 3PL or ship for the released output lot#{plural_s(Map.get(mo, :output_needs_routing_count, 0))}."
          }
        end)
    }
  end

  defp next_action_for(:ready_to_dispatch, co, _, _, _) do
    %{
      code: "ready_to_dispatch",
      title: "All MOs complete and stock is back in the warehouse.",
      detail:
        "This order is ready to ship. (Dispatch module isn't built yet — generate the invoice and arrange a courier manually.)",
      primary_cta: %{
        label: "Generate invoice",
        kind: "link",
        href: "/sales/orders/#{co.uuid}"
      },
      secondary_ctas: []
    }
  end

  # ----- line state ----------------------------------------------

  defp line_state(%CustomerOrder{company_id: company_id}, %CustomerOrderLine{} = line) do
    mos =
      from(m in ManufacturingOrder,
        where: m.customer_order_line_id == ^line.id,
        order_by: [asc: m.inserted_at, asc: m.id],
        preload: [:item]
      )
      |> Repo.all()
      |> Enum.map(&mo_state/1)

    primary_mo = List.first(mos)
    needs_mo? = needs_mo_for_line?(line)

    # Surface the active BOMs for this line's item so the FE can show
    # a picker when there's more than one, or auto-pick when there's
    # exactly one. Only queried when no MO exists yet — no point if
    # the BOM is already committed.
    available_boms =
      if needs_mo? and is_nil(primary_mo) and line.item_id do
        active_boms_for_item(company_id, line.item_id)
      else
        []
      end

    %{
      uuid: line.uuid,
      id: line.id,
      item_id: line.item_id,
      item_name: line.item && line.item.name,
      qty_ordered: line.qty_ordered,
      mos: mos,
      primary_mo: primary_mo,
      needs_mo?: needs_mo?,
      available_boms: available_boms
    }
  end

  defp active_boms_for_item(company_id, item_id) do
    Production.list_for_item(company_id, item_id)
    |> Enum.filter(& &1.is_active)
    |> Enum.map(fn bom ->
      %{
        id: bom.id,
        uuid: bom.uuid,
        name: bom.name,
        code: bom_code(bom),
        is_primary: bom.is_primary
      }
    end)
  end

  defp bom_code(%BOM{id: id}) do
    case Backend.Companies.current() do
      nil -> nil
      company -> Backend.Numbering.render(id, company, "bom")
    end
  end

  defp needs_mo_for_line?(%CustomerOrderLine{item: nil}), do: false

  defp needs_mo_for_line?(%CustomerOrderLine{item: %{item_type: item_type}})
       when item_type in ["finished_product", "semi_finished"],
       do: true

  defp needs_mo_for_line?(_), do: false

  defp line_summary(line_state) do
    "#{format_decimal(line_state.qty_ordered)} × #{line_state.item_name || "—"}"
  end

  # ----- mo state ------------------------------------------------

  defp mo_state(%ManufacturingOrder{} = mo) do
    mo =
      Repo.preload(mo, [
        :item,
        :children,
        :pickup_started_by,
        bookings: [],
        bom: [lines: :part]
      ])

    # Recurse into child MOs (auto-spawned for semi-finished
    # sub-assemblies). The chain has to be sorted top-to-bottom
    # before the order can leave production_planning — a parent
    # MO with an unhandled child is no different from a parent
    # MO with unhandled bookings.
    child_states = Enum.map(mo.children, &mo_state/1)

    # `count_under_booked_lines` only credits bookings that are still
    # `status == "requested"` (the ones holding stock at the floor).
    # The moment booking closeout flips them to `consumed`, those rows
    # fall out and the line *looks* unbooked again. That's fine for an
    # in-flight MO (re-booking would be a real action) but dead wrong
    # for a `completed` MO — the work happened, the consumption is on
    # record via Movement rows, and the wizard would otherwise jump
    # back to "Request purchases for MO X" days after the MO closed.
    # Cancelled MOs follow the same logic — there's no shortage to
    # chase if the MO was abandoned. Treat both as zero.
    under_booked =
      if mo.status in ["completed", "cancelled"],
        do: 0,
        else: count_under_booked_lines(mo)

    placeholder_bookings =
      Enum.filter(mo.bookings, &(not is_nil(&1.purchase_order_line_id)))

    placeholder_po_line_ids =
      placeholder_bookings
      |> Enum.map(& &1.purchase_order_line_id)
      |> Enum.uniq()

    placeholder_po_uuids = po_uuids_for_line_ids(placeholder_po_line_ids)
    placeholder_po_statuses = po_statuses_for_line_ids(placeholder_po_line_ids)
    placeholder_po_status_by_line_id = po_status_by_line_id(placeholder_po_line_ids)

    has_unsent_placeholder_po? =
      Enum.any?(placeholder_po_statuses, &(&1 in ~w(draft pending_approver pending_director approved)))

    has_sent_placeholder_po? =
      Enum.any?(placeholder_po_statuses, &(&1 in ~w(ordered partially_received)))

    # Per-placeholder bucketing so the FE chip can split N awaiting QC
    # vs N awaiting delivery vs N need PO instead of lumping them all
    # under "awaiting delivery".
    placeholder_breakdown =
      Enum.reduce(
        placeholder_bookings,
        %{awaiting_qc: 0, in_transit: 0, not_sent: 0},
        fn b, acc ->
          status = Map.get(placeholder_po_status_by_line_id, b.purchase_order_line_id)

          cond do
            status in @awaiting_qc_po_statuses ->
              Map.update!(acc, :awaiting_qc, &(&1 + 1))

            status in @sent_po_statuses ->
              Map.update!(acc, :in_transit, &(&1 + 1))

            true ->
              Map.update!(acc, :not_sent, &(&1 + 1))
          end
        end
      )

    output_lots = output_lots_for_mo(mo)
    feed_lots = Enum.filter(output_lots, & &1.at_production_feed?)
    warehouse_lots = output_lots -- feed_lots
    # Output QC = a manufacturing_order lot in `received` status. The
    # closeout flow creates them in that state; sign_off_output_qc
    # flips them to `available` (pass) or `qc_failed` (fail). Counting
    # this surfaces the "production finished but QC still owes a
    # verdict" sub-stage on the wizard before closeout can advance.
    output_qc_pending_count =
      Enum.count(output_lots, &(&1.status == "received"))

    # Output lots that still owe a Final Product Release ceremony
    # (BRCGS Issue 9 § 5.6 Positive Release). Includes both:
    #
    #   * `awaiting_release` — the new-flow path where output QC
    #     parks the lot in a finished-quarantine cell.
    #   * `available` legacy lots without a terminal release row —
    #     these went through the pre-gate QC flow that flipped
    #     straight to `available`, so an auditor asking "show me
    #     the release record for lot X" would find nothing. Force
    #     the ceremony retroactively rather than silently marking
    #     the order Done.
    #
    # Sub-MO outputs reserved by a live parent MO ride the parent's
    # release — they're filtered out by `needs_release?`.
    needs_release_lots = Enum.filter(output_lots, & &1.needs_release?)

    output_awaiting_release_count = length(needs_release_lots)

    output_awaiting_release_lot_uuids =
      Enum.map(needs_release_lots, & &1.uuid)

    # Split by placement so the wizard can propose the correct next
    # step. A release-owed lot that isn't in a finished_quarantine
    # cell needs the warehouse move FIRST (via /m/putaway, standard
    # scan-lot → scan-cell → photo procedure). Only once it's
    # physically parked in the release-holding bay does the QA form
    # unblock — hitting "Open Final Product Release" earlier just
    # walls the operator off at the form entry.
    release_move_needed_lots =
      Enum.filter(needs_release_lots, &(not &1.in_finished_quarantine?))

    release_ready_lots =
      Enum.filter(needs_release_lots, & &1.in_finished_quarantine?)

    output_release_move_needed_count = length(release_move_needed_lots)
    output_release_ready_count = length(release_ready_lots)

    output_release_move_needed_lot_uuids =
      Enum.map(release_move_needed_lots, & &1.uuid)

    output_release_ready_lot_uuids =
      Enum.map(release_ready_lots, & &1.uuid)

    # Positively-released outputs that still owe a 3PL vs shipment
    # routing decision. Feeds the awaiting_routing phase + wizard CTA.
    needs_routing_lots =
      Enum.filter(output_lots, &Map.get(&1, :needs_routing?, false))

    output_needs_routing_count = length(needs_routing_lots)

    output_needs_routing_lot_uuids =
      Enum.map(needs_routing_lots, & &1.uuid)

    # Same rationale as `under_booked` above — a `completed` or
    # `cancelled` MO can't be acted on procurement-side, so any
    # leftover placeholder bookings are noise. The wizard would
    # otherwise stay parked on "Awaiting ingredients" forever.
    has_placeholders =
      placeholder_bookings != [] and mo.status not in ["completed", "cancelled"]
    past_approval = mo.status in ["approved", "scheduled", "in_progress", "completed"]
    broken_booking_count = count_broken_bookings(mo.bookings)

    # Bookings on a completed MO that the operator hasn't run through
    # the per-booking closeout yet (status still "requested", no
    # consumed_at stamp). Closeout records consumed_quantity + routes
    # the leftover ingredient material to a dispatch cell — it has to
    # finish BEFORE warehouse return-pickup, otherwise the picker
    # walks back only the produced outputs and leaves the dispatch
    # pile orphaned on the production side.
    bookings_closeout_pending_count =
      Enum.count(mo.bookings, &(&1.status == "requested" and is_nil(&1.consumed_at)))

    # "Fully sorted" = planner is done with this MO. Two signatures
    # in (approved+) AND no broken bookings. Placeholder bookings
    # that point at a live PO line are fine — procurement is engaged
    # by construction (PO cancellation deletes placeholders, so a
    # placeholder existing IS the procurement signal). The separate
    # `purchasing_requested_at` flag isn't a reliable test here
    # because `prepare_mo` clears it on transition; the actual
    # source of truth is the placeholder + its live PO line.
    is_fully_sorted = past_approval and broken_booking_count == 0

    %{
      id: mo.id,
      uuid: mo.uuid,
      code: render_code(mo, "manufacturing_order"),
      status: mo.status,
      quantity: mo.quantity,
      item_name: mo.item && mo.item.name,
      customer_order_line_id: mo.customer_order_line_id,
      bookings_total: length(mo.bookings),
      placeholder_count: length(placeholder_bookings),
      placeholder_awaiting_qc_count: placeholder_breakdown.awaiting_qc,
      placeholder_in_transit_count: placeholder_breakdown.in_transit,
      placeholder_not_sent_count: placeholder_breakdown.not_sent,
      has_placeholder_bookings?: has_placeholders,
      placeholder_po_uuids: placeholder_po_uuids,
      has_unsent_placeholder_po?: has_unsent_placeholder_po?,
      has_sent_placeholder_po?: has_sent_placeholder_po?,
      broken_booking_count: broken_booking_count,
      under_booked_count: under_booked,
      output_lots: Enum.map(output_lots, &lot_summary/1),
      output_lot_count: length(output_lots),
      output_at_feed_count: length(feed_lots),
      output_in_warehouse_count: length(warehouse_lots),
      output_qc_pending_count: output_qc_pending_count,
      output_awaiting_release_count: output_awaiting_release_count,
      output_awaiting_release_lot_uuids: output_awaiting_release_lot_uuids,
      output_release_move_needed_count: output_release_move_needed_count,
      output_release_move_needed_lot_uuids: output_release_move_needed_lot_uuids,
      output_release_ready_count: output_release_ready_count,
      output_needs_routing_count: output_needs_routing_count,
      output_needs_routing_lot_uuids: output_needs_routing_lot_uuids,
      output_release_ready_lot_uuids: output_release_ready_lot_uuids,
      bookings_closeout_pending_count: bookings_closeout_pending_count,
      has_output_at_production_feed?:
        mo.status == "completed" and feed_lots != [],
      # Cancelled MO with picked bookings whose lots never got
      # consumed — the warehouse picker still owes a return-pickup
      # to walk them back to storage. Surfaced to the wizard so the
      # planner sees "N orphaned lots awaiting return" instead of
      # the MO card just fading out of view when the status flipped
      # to cancelled.
      cancelled_orphan_booking_count:
        if mo.status == "cancelled" do
          Enum.count(mo.bookings, fn b ->
            b.status == "requested" and
              not is_nil(b.picked_at) and
              is_nil(b.consumed_at)
          end)
        else
          0
        end,
      purchasing_requested_at: mo.purchasing_requested_at,
      pickup_started_at: mo.pickup_started_at,
      pickup_started_by_name:
        case mo.pickup_started_by do
          %{name: name} when is_binary(name) -> name
          _ -> nil
        end,
      pickup_completed_at: mo.pickup_completed_at,
      # True when every raw/packaging/semi booking has received_at
      # set — the production operator has signed off the preflight
      # and `start_mo_production` will accept the scheduled →
      # in_progress flip. The wizard uses this to split the
      # "scheduled + pickup done" stage into "awaiting preflight" vs
      # "ready to start run".
      preflight_complete?: Production.mo_preflight_complete?(mo),
      is_fully_sorted?: is_fully_sorted,
      children: child_states,
      # Descendants (children + grandchildren, recursively) whose work
      # isn't finished yet. Drives the "Do this next" ranker so a
      # parent MO with an open child sorts AFTER its child — parents
      # can't run until their sub-assemblies are done producing the
      # ingredient, so the child is the honest next action.
      open_descendants_count: count_open_descendants(child_states),
      due_date: mo.due_date
    }
  end

  # Recursive walk over child_states. A descendant is "open" when it
  # has pending work (mo_has_pending_work?/1) — this includes the
  # post-run closeout / QC / return-pickup tail so a parent doesn't
  # jump ahead of a child that's technically completed but still
  # owes downstream steps that could break the parent's inputs.
  defp count_open_descendants(child_states) when is_list(child_states) do
    Enum.reduce(child_states, 0, fn child, acc ->
      self_count = if mo_has_pending_work?(child), do: 1, else: 0
      acc + self_count + count_open_descendants(Map.get(child, :children, []) || [])
    end)
  end

  defp count_open_descendants(_), do: 0

  # Per-MO count of BOM lines where booked + pending-from-children
  # is still less than required. Mirrors the rule in
  # Backend.Production.ensure_all_lines_fully_booked but inline so
  # the wizard avoids an extra round-trip per MO.
  defp count_under_booked_lines(%ManufacturingOrder{} = mo) do
    lines =
      case mo.bom do
        %{lines: lines} when is_list(lines) -> lines
        _ -> []
      end

    mo_qty = mo.quantity || Decimal.new(0)

    # Group children by the item they PRODUCE. We keep COMPLETED
    # children in the mix and credit their `quantity_produced` (the
    # real output that's now in lots) instead of `quantity` (the
    # plan). Without this, the wizard regresses to "Awaiting
    # ingredients" the moment a child closes out — the planned 292 kg
    # was covering the parent, the child produces 292 kg, but the
    # filter drops the row and the parent looks short again.
    # Cancelled children stay excluded — they never produced anything.
    children_by_item =
      (Map.get(mo, :children) || [])
      |> Enum.reject(&(&1.status == "cancelled"))
      |> Enum.group_by(& &1.item_id)

    Enum.count(lines, fn line ->
      case line.part do
        %{id: part_id, item_type: t} when t in ["raw_material", "packaging", "semi_finished"] ->
          required =
            if line.is_fixed do
              line.qty || Decimal.new(0)
            else
              Decimal.mult(line.qty || Decimal.new(0), mo_qty)
            end

          booked =
            mo.bookings
            |> Enum.filter(fn b -> b.item_id == part_id and b.status == "requested" end)
            |> Enum.reduce(Decimal.new(0), fn b, acc ->
              Decimal.add(acc, b.quantity || Decimal.new(0))
            end)

          pending =
            children_by_item
            |> Map.get(part_id, [])
            |> Enum.reduce(Decimal.new(0), fn c, acc ->
              # Completed child: trust the real output qty. Anything
              # in-flight: trust the planned qty.
              contrib =
                cond do
                  c.status == "completed" and not is_nil(c.quantity_produced) ->
                    c.quantity_produced

                  true ->
                    c.quantity || Decimal.new(0)
                end

              Decimal.add(acc, contrib)
            end)

          Decimal.compare(required, Decimal.add(booked, pending)) == :gt

        _ ->
          false
      end
    end)
  end

  # Flatten a parent MO + its descendants into a single list.
  # Used so phase / next-action calculations cover the full chain
  # — a child MO blocks the order from advancing just like the
  # parent does.
  defp flatten_mo_tree(mo_state) do
    children = Map.get(mo_state, :children, []) || []
    [mo_state | Enum.flat_map(children, &flatten_mo_tree/1)]
  end

  # Title + detail for an MO that's stuck in production_planning.
  # The "why" is one of: missing first signature (Prepare), missing
  # second signature (Approve), or broken bookings that need re-doing.
  # Naming it gives the operator a one-glance reason and a deep-link.
  defp unfinished_mo_reason(mo, total_unfinished) do
    others =
      if total_unfinished > 1,
        do: " (#{total_unfinished - 1} more MO#{if total_unfinished - 1 == 1, do: "", else: "s"} also pending)",
        else: ""

    procurement_engaged = not is_nil(mo.purchasing_requested_at)

    cond do
      mo.status == "draft" and procurement_engaged ->
        {"MO #{mo.code} is ready to sign — procurement already engaged.",
         "You've allocated what's in stock and sent the shortfall to procurement. Open the MO and sign Prepare — there's nothing else to sort here#{others}."}

      mo.status == "draft" ->
        {"MO #{mo.code} needs its first signature.",
         "It's still draft. Open the MO, allocate stock for what we have, hit Request purchases for what we don't, then sign Prepare#{others}."}

      mo.status == "prepared" ->
        {"MO #{mo.code} needs its second signature.",
         "Prepare is done. Open the MO and have someone other than the preparer sign Approve — that's the segregation-of-duties gate#{others}. Once approved, the MO is ready and the order can advance to Ingredients."}

      mo.broken_booking_count > 0 ->
        {"MO #{mo.code} has broken bookings.",
         "#{mo.broken_booking_count} booking#{if mo.broken_booking_count == 1, do: " is", else: "s are"} no longer valid (lot moved, PO cancelled, or over-allocated). Open the MO to re-book#{others}."}

      true ->
        {"MO #{mo.code} isn't fully sorted yet.",
         "Open the MO to finish bookings and signatures#{others}."}
    end
  end

  defp po_uuids_for_line_ids([]), do: []

  defp po_uuids_for_line_ids(po_line_ids) do
    from(pol in Backend.Purchasing.PurchaseOrderLine,
      where: pol.id in ^po_line_ids,
      join: po in PurchaseOrder, on: po.id == pol.purchase_order_id,
      select: po.uuid,
      distinct: true
    )
    |> Repo.all()
  end

  defp po_statuses_for_line_ids([]), do: []

  defp po_statuses_for_line_ids(po_line_ids) do
    from(pol in Backend.Purchasing.PurchaseOrderLine,
      where: pol.id in ^po_line_ids,
      join: po in PurchaseOrder, on: po.id == pol.purchase_order_id,
      select: po.status,
      distinct: true
    )
    |> Repo.all()
  end

  # Per-line PO status lookup so we can bucket EACH placeholder
  # booking by the state of the PO covering it (not_sent / in_transit
  # / awaiting_qc). The distinct version above loses that mapping.
  defp po_status_by_line_id([]), do: %{}

  defp po_status_by_line_id(po_line_ids) do
    from(pol in Backend.Purchasing.PurchaseOrderLine,
      where: pol.id in ^po_line_ids,
      join: po in PurchaseOrder, on: po.id == pol.purchase_order_id,
      select: {pol.id, po.status}
    )
    |> Repo.all()
    |> Map.new()
  end

  defp count_broken_bookings([]), do: 0

  defp count_broken_bookings(bookings) do
    # A booking is "broken" when its lot is no longer `available` OR
    # the lot's on-hand is now less than the sum of all requested
    # bookings against it (over-allocated). Earlier this read a stub
    # `:is_broken` field that nothing ever populated — so wizard
    # never surfaced reality drift caused by closeout spillage.
    # Mirrors `Backend.Production.list_broken_bookings_for/1` but
    # inline per MO so the wizard's per-MO state stays self-contained.
    lot_ids =
      bookings
      |> Enum.flat_map(fn b ->
        if b.status == "requested" and not is_nil(b.stock_lot_id),
          do: [b.stock_lot_id],
          else: []
      end)
      |> Enum.uniq()

    if lot_ids == [] do
      0
    else
      on_hand_by_lot =
        from(p in Backend.Stock.Placement,
          where: p.stock_lot_id in ^lot_ids,
          group_by: p.stock_lot_id,
          select: {p.stock_lot_id, sum(p.qty)}
        )
        |> Repo.all()
        |> Map.new()

      total_booked_by_lot =
        from(b in Backend.Production.ManufacturingOrderBooking,
          where:
            b.stock_lot_id in ^lot_ids and
              b.status == "requested",
          group_by: b.stock_lot_id,
          select: {b.stock_lot_id, sum(b.quantity)}
        )
        |> Repo.all()
        |> Map.new()

      lot_status_by_id =
        from(l in Backend.Stock.Lot,
          where: l.id in ^lot_ids,
          select: {l.id, l.status}
        )
        |> Repo.all()
        |> Map.new()

      Enum.count(bookings, fn b ->
        cond do
          b.status != "requested" ->
            false

          is_nil(b.stock_lot_id) ->
            false

          Map.get(lot_status_by_id, b.stock_lot_id) != "available" ->
            true

          true ->
            on_hand =
              Map.get(on_hand_by_lot, b.stock_lot_id) || Decimal.new(0)

            total_demand =
              Map.get(total_booked_by_lot, b.stock_lot_id) || Decimal.new(0)

            Decimal.compare(total_demand, on_hand) == :gt
        end
      end)
    end
  end

  defp output_lots_for_mo(%ManufacturingOrder{uuid: mo_uuid}) do
    # Lots created by this MO have source_kind = "manufacturing_order"
    # and source_ref = "<mo.uuid>" (set by `create_produced_lots` in
    # Backend.Production.finish_mo_production). Earlier this code
    # compared against `mo.id` as a string, which never matched —
    # making every MO look like it had zero outputs and short-
    # circuiting the wizard's closeout / QC sub-stages.
    lots =
      from(l in Lot,
        where:
          l.source_kind == "manufacturing_order" and
            l.source_ref == ^mo_uuid,
        preload: [placements: [storage_cell: []]]
      )
      |> Repo.all()

    # A lot that a live downstream MO has already picked as an
    # ingredient is physically "in flight for consumption" — the
    # consumer MO's closeout owns the discharge, NOT a return-pickup
    # to warehouse. Look up which of these lot ids are committed
    # once so the wizard can honestly say has_output_at_production_feed
    # only for genuinely orphaned outputs (that need the warehouse
    # picker) and not for outputs that are actually being consumed.
    lot_ids = Enum.map(lots, & &1.id)

    committed_ids =
      if lot_ids == [] do
        MapSet.new()
      else
        from(b in Backend.Production.ManufacturingOrderBooking,
          join: mo in ManufacturingOrder,
          on: mo.id == b.manufacturing_order_id,
          where:
            b.stock_lot_id in ^lot_ids and
              b.status == "requested" and
              not is_nil(b.picked_at) and
              is_nil(b.consumed_at) and
              mo.status != "cancelled",
          select: b.stock_lot_id
        )
        |> Repo.all()
        |> MapSet.new()
      end

    # `downstream_reserved_ids` = ANY downstream booking on the lot
    # (any status, any lifecycle stage) as long as the consuming MO
    # isn't cancelled. Broader than `committed_ids` on purpose — for
    # release-owed math we want to skip lots that ANY parent MO ever
    # reserved as an ingredient, even after that parent's own
    # closeout consumed them. Those lots rode the parent's release,
    # not their own.
    downstream_reserved_ids =
      if lot_ids == [] do
        MapSet.new()
      else
        from(b in Backend.Production.ManufacturingOrderBooking,
          join: mo in ManufacturingOrder,
          on: mo.id == b.manufacturing_order_id,
          where:
            b.stock_lot_id in ^lot_ids and
              mo.status != "cancelled",
          select: b.stock_lot_id
        )
        |> Repo.all()
        |> MapSet.new()
      end

    # Lots that already have a terminal Final Product Release row
    # (released / on_hold / rejected). No more release owed on these
    # — the ceremony has been completed one way or another.
    released_or_finalized_ids =
      if lot_ids == [] do
        MapSet.new()
      else
        from(r in Backend.Production.FinalRelease,
          where:
            r.stock_lot_id in ^lot_ids and
              r.status in ["released", "on_hold", "rejected"],
          select: r.stock_lot_id
        )
        |> Repo.all()
        |> MapSet.new()
      end

    # Successfully-released subset — narrower than
    # released_or_finalized_ids because on_hold / rejected lots don't
    # need routing. Only positively-released lots owe a 3PL vs
    # shipment routing decision.
    released_ok_ids =
      if lot_ids == [] do
        MapSet.new()
      else
        from(r in Backend.Production.FinalRelease,
          where:
            r.stock_lot_id in ^lot_ids and
              r.status == "released",
          select: r.stock_lot_id
        )
        |> Repo.all()
        |> MapSet.new()
      end

    # Lots that already have a routing decision on the timeline —
    # either routed_to_3pl or routed_to_shipment. No routing owed.
    routed_ids =
      if lot_ids == [] do
        MapSet.new()
      else
        from(e in Backend.Stock.LotEvent,
          where:
            e.stock_lot_id in ^lot_ids and
              e.kind in ["routed_to_3pl", "routed_to_shipment"],
          select: e.stock_lot_id,
          distinct: true
        )
        |> Repo.all()
        |> MapSet.new()
      end

    Enum.map(
      lots,
      &lot_with_placement(
        &1,
        committed_ids,
        downstream_reserved_ids,
        released_or_finalized_ids,
        released_ok_ids,
        routed_ids
      )
    )
  end

  defp lot_with_placement(
         %Lot{} = lot,
         committed_ids \\ MapSet.new(),
         downstream_reserved_ids \\ MapSet.new(),
         released_or_finalized_ids \\ MapSet.new(),
         released_ok_ids \\ MapSet.new(),
         routed_ids \\ MapSet.new()
       ) do
    # "At production side" = anywhere the warehouse picker can fetch
    # the lot from on return-pickup. Matches the queue-side rule in
    # `Backend.Warehouses.ReturnPickup` (@return_pickup_purposes:
    # dispatch + production_feed). Before this, the wizard only
    # counted `production_feed`, so the second closeout moved each
    # output lot to a `dispatch` cell and the wizard stopped surfacing
    # the "send return-pickup" CTA — the warehouse picker would never
    # be paged for output lots that came out of closeout.
    physically_at_feed? =
      Enum.any?(lot.placements, fn p ->
        p.storage_cell && p.storage_cell.purpose in ["production_feed", "dispatch"]
      end)

    # `at_production_feed?` = "warehouse picker owes a return trip on
    # this lot". If a live downstream MO already picked it as an
    # ingredient, the discharge belongs to that MO's closeout — a
    # return would double-book the ingredient. Kept the field name so
    # every existing reader (queue, wizard CTA, chip strip) picks up
    # the corrected semantics without a rename cascade.
    committed? = MapSet.member?(committed_ids, lot.id)

    # `needs_release?` = "QA still owes a Positive Release ceremony on
    # this finished-goods lot" (BRCGS Issue 9 § 5.6). True when:
    #   * lot is a top-of-tree output (no live downstream MO booking
    #     — those ride the parent's release), AND
    #   * lot doesn't already have a terminal release row, AND
    #   * lot is at a status where release is applicable — either
    #     `awaiting_release` (new-flow: parked in finished_quarantine
    #     waiting for signatures) OR `available` (legacy pre-gate
    #     lots that skipped the ceremony entirely and now need it
    #     retroactively so the audit trail is complete).
    reserved_downstream? =
      MapSet.member?(downstream_reserved_ids, lot.id)

    already_finalized? =
      MapSet.member?(released_or_finalized_ids, lot.id)

    needs_release? =
      lot.source_kind == "manufacturing_order" and
        lot.status in ["awaiting_release", "available"] and
        not reserved_downstream? and
        not already_finalized?

    # `in_finished_quarantine?` = every active placement sits in a
    # finished_quarantine cell (BRCGS § 4.4 segregation). Splits the
    # release owe into "needs the warehouse move first" vs "ready for
    # QA sign-off" so the wizard proposes the correct next step —
    # attempting the ceremony while the lot's on general shelving
    # hard-blocks at the form entry.
    in_finished_quarantine? =
      case Enum.filter(lot.placements, fn p ->
             p.qty && Decimal.compare(p.qty, Decimal.new(0)) == :gt
           end) do
        [] ->
          false

        active ->
          Enum.all?(active, fn p ->
            p.storage_cell && p.storage_cell.purpose == "finished_quarantine"
          end)
      end

    # `needs_routing?` = positively-released lot that hasn't yet been
    # answered "3PL storage or direct shipment?". Guards against
    # already-routed lots (routed_ids) + downstream-consumed lots
    # (their routing rides the parent).
    released_ok? = MapSet.member?(released_ok_ids, lot.id)
    already_routed? = MapSet.member?(routed_ids, lot.id)

    needs_routing? =
      released_ok? and
        not already_routed? and
        not MapSet.member?(downstream_reserved_ids, lot.id)

    %{
      id: lot.id,
      uuid: lot.uuid,
      supplier_batch_no: lot.supplier_batch_no,
      status: lot.status,
      qty_received: lot.qty_received,
      ownership_kind: lot.ownership_kind,
      placements: lot.placements,
      at_production_feed?: physically_at_feed? and not committed?,
      needs_release?: needs_release?,
      in_finished_quarantine?: in_finished_quarantine?,
      needs_routing?: needs_routing?
    }
  end

  defp lot_summary(%{} = lot_state) do
    %{
      # Keep the DB id in the wizard's payload struct so
      # `Payloads.render_code/2` can turn it into the company-
      # configured lot code (L00173-style). Without this the wizard
      # showed the raw UUID prefix and every operator saw a
      # different-looking snippet for the same lot.
      id: lot_state.id,
      uuid: lot_state.uuid,
      supplier_batch_no: lot_state.supplier_batch_no,
      status: lot_state.status,
      qty: lot_state.qty_received,
      at_production_feed?: lot_state.at_production_feed?,
      # 3PL routing follow-up flags. `needs_routing?` drives the
      # wizard's awaiting_routing CTA; `ownership_kind` tells the FE
      # to render the bailee custody chip once the choice has been made.
      needs_routing?: Map.get(lot_state, :needs_routing?, false),
      ownership_kind: Map.get(lot_state, :ownership_kind, "own")
    }
  end

  # ----- blockers ------------------------------------------------

  defp compute_blockers(_co, _line_states, mos) do
    broken =
      mos
      |> Enum.filter(&(&1.broken_booking_count > 0))
      |> Enum.map(fn mo ->
        %{
          code: "broken_bookings",
          severity: "error",
          message:
            "MO #{mo.code} has #{mo.broken_booking_count} broken booking(s) — pickers will fail until you pull them back into planning.",
          link: %{
            label: "Open MO",
            href: "/production/manufacturing-orders/#{mo.uuid}"
          }
        }
      end)

    placeholders =
      if Enum.any?(mos, & &1.has_placeholder_bookings?) and
           Enum.any?(mos, &(&1.status in ["scheduled", "in_progress"])) do
        [
          %{
            code: "production_started_with_placeholders",
            severity: "warning",
            message:
              "Production has started but some MOs still rely on placeholder bookings against open POs. If the POs slip, runs will break.",
            link: %{label: "Open shortages", href: "/procurement/shortages"}
          }
        ]
      else
        []
      end

    broken ++ placeholders
  end

  # ----- timeline ------------------------------------------------

  defp timeline(co, _mos, signers) do
    approver_event =
      signers.approver &&
        %{
          at: signers.approver.signed_at,
          label:
            "Approver: #{(signers.approver.signed_by && signers.approver.signed_by.name) || "—"}",
          scope: "co"
        }

    director_event =
      signers.director &&
        %{
          at: signers.director.signed_at,
          label:
            "Director: #{(signers.director.signed_by && signers.director.signed_by.name) || "—"}",
          scope: "co"
        }

    co_events =
      [
        co.inserted_at && %{at: co.inserted_at, label: "Order created", scope: "co"},
        co.submitted_at &&
          %{at: co.submitted_at, label: "Submitted for approval", scope: "co"},
        approver_event,
        director_event,
        co.confirmed_at &&
          %{at: co.confirmed_at, label: "Confirmed — released for production", scope: "co"},
        co.cancelled_at && %{at: co.cancelled_at, label: "Cancelled", scope: "co"}
      ]
      |> Enum.reject(&is_nil/1)

    co_events
    |> Enum.reject(&is_nil(&1.at))
    |> Enum.sort_by(& &1.at, {:asc, DateTime})
  end

  # ----- helpers --------------------------------------------------

  defp preload_co(%CustomerOrder{} = co) do
    Repo.preload(co, [
      :customer,
      :created_by,
      :submitted_by,
      :confirmed_by,
      lines: [:item]
    ])
  end

  defp customer_effectively_approved?(%CustomerOrder{customer: nil}), do: false

  defp customer_effectively_approved?(%CustomerOrder{customer: customer}) do
    case Backend.Customers.effective_approval_status(customer) do
      {:approved, _} -> true
      _ -> false
    end
  end

  defp open_pos_for(mos) do
    uuids = mos |> Enum.flat_map(& &1.placeholder_po_uuids) |> Enum.uniq()

    case uuids do
      [] ->
        []

      _ ->
        from(po in PurchaseOrder,
          where: po.uuid in ^uuids,
          order_by: [asc: po.expected_delivery_date, asc: po.id],
          select: %{
            id: po.id,
            uuid: po.uuid,
            status: po.status,
            expected_delivery_date: po.expected_delivery_date,
            grand_total: po.grand_total,
            currency_code: po.currency_code
          }
        )
        |> Repo.all()
    end
  end

  # True when an MO still has work hanging off it. Non-completed
  # MOs always count. Completed MOs count when output QC hasn't
  # signed off all output lots, OR outputs are still sitting at the
  # production-feed cell waiting for the warehouse fetch, OR outputs
  # cleared QC but still owe Final Product Release (BRCGS 5.6). The
  # "Do this next" punch-list uses this to surface every step that
  # still needs an operator's attention.
  defp mo_has_pending_work?(%{status: "completed"} = mo) do
    Map.get(mo, :output_qc_pending_count, 0) > 0 or
      Map.get(mo, :has_output_at_production_feed?) == true or
      Map.get(mo, :output_awaiting_release_count, 0) > 0
  end

  defp mo_has_pending_work?(%{status: status}) when is_binary(status), do: true

  defp mo_has_pending_work?(_), do: false

  defp mo_priority(mo) do
    status = Map.get(mo, :status)
    pb = Map.get(mo, :has_placeholder_bookings?, false)
    bb = Map.get(mo, :broken_booking_count, 0)
    open_descendants = Map.get(mo, :open_descendants_count, 0)

    status_priority =
      case status do
        "in_progress" -> 0
        "scheduled" -> 1
        "approved" -> 2
        "prepared" -> 3
        "draft" -> 4
        _ -> 5
      end

    blocker_priority =
      cond do
        bb > 0 -> -100
        pb -> -50
        true -> 0
      end

    # Deep-first ordering: an MO with unfinished descendants can't
    # actually run yet (its bookings depend on those children's
    # outputs), so the child is the honest next action. +10 nudges
    # parents behind leaves within the same status band without
    # overriding the broken-bookings / placeholder blockers which
    # are the real emergencies.
    tree_priority = if open_descendants > 0, do: 10, else: 0

    blocker_priority + status_priority + tree_priority
  end

  defp render_code(%{id: id}, entity_key) when is_integer(id) do
    case Backend.Companies.current() do
      nil -> nil
      company -> Backend.Numbering.render(id, company, entity_key)
    end
  end

  defp render_code(_, _), do: nil

  defp format_date(nil), do: nil

  defp format_date(%Date{} = d), do: Date.to_iso8601(d)

  defp format_decimal(%Decimal{} = d), do: Decimal.to_string(d, :normal)

  defp format_decimal(n) when is_integer(n) or is_float(n), do: to_string(n)

  defp format_decimal(_), do: "—"
end
