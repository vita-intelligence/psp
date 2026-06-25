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

  alias Backend.CustomerOrders.{CustomerOrder, CustomerOrderLine}
  alias Backend.Production.{ManufacturingOrder, ManufacturingOrderBooking}
  alias Backend.Purchasing.PurchaseOrder
  alias Backend.Repo
  alias Backend.Stock.{Lot, Placement}
  alias Backend.Warehouses.StorageCell

  @phases [:setup, :approval, :production_planning, :awaiting_ingredients,
           :in_production, :closeout, :ready_to_dispatch]
  @total_phases length(@phases)

  @doc """
  Compact summary of every "active" CO in the company — anything
  that isn't `draft` or `cancelled`. Used by the /projects landing
  page so a worker sees every job in flight without clicking into
  each one. Each row carries enough state to render the phase
  badge, the next-action title, and a blocker chip.

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
      where: co.status not in ["draft", "cancelled"],
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
    all_mos = line_states |> Enum.flat_map(& &1.mos)
    blockers = compute_blockers(co, line_states, all_mos)
    phase = derive_phase(co, line_states, all_mos)

    %{
      customer_order: co,
      phase: phase_payload(phase),
      next_action: next_action_for(phase, co, line_states, all_mos),
      blockers: blockers,
      lines: line_states,
      mos: all_mos,
      open_pos: open_pos_for(all_mos),
      timeline: timeline(co, all_mos)
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
      Enum.any?(line_states, &(&1.needs_mo? and is_nil(&1.primary_mo))) ->
        :production_planning

      Enum.any?(mos, & &1.has_placeholder_bookings?) ->
        :awaiting_ingredients

      not Enum.all?(mos, &(&1.status == "completed")) ->
        :in_production

      Enum.any?(mos, & &1.has_output_at_production_feed?) ->
        :closeout

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
  defp phase_label(:ready_to_dispatch), do: "Ready to dispatch"
  defp phase_label(:cancelled), do: "Cancelled"

  # ----- next_action derivation ----------------------------------

  defp next_action_for(:cancelled, co, _, _) do
    %{
      code: "cancelled",
      title: "This order was cancelled.",
      detail:
        co.cancellation_reason && "Reason: #{co.cancellation_reason}",
      primary_cta: nil,
      secondary_ctas: []
    }
  end

  defp next_action_for(:setup, co, _line_states, _mos) do
    cond do
      co.lines == [] ->
        %{
          code: "add_lines",
          title: "Add at least one line to the order.",
          detail:
            "An empty draft can't be submitted. Open the Lines card on this order and pick the items the customer wants.",
          primary_cta: %{
            label: "Open lines",
            kind: "scroll_to",
            target: "#co-lines"
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

  defp next_action_for(:approval, co, _line_states, _mos) do
    case co.status do
      "pending_approver" ->
        %{
          code: "awaiting_approver",
          title: "Awaiting approver signature.",
          detail:
            "Whoever isn't the order's author needs to sign as the approver tier. They open this CO and click Approve.",
          primary_cta: %{
            label: "Open order",
            kind: "link",
            href: "/sales/orders/#{co.uuid}"
          },
          secondary_ctas: []
        }

      "pending_director" ->
        %{
          code: "awaiting_director",
          title: "Awaiting director signature.",
          detail:
            "Approver has signed. A director (different from the approver) needs to sign to finalise.",
          primary_cta: %{
            label: "Open order",
            kind: "link",
            href: "/sales/orders/#{co.uuid}"
          },
          secondary_ctas: []
        }

      "approved" ->
        %{
          code: "mark_confirmed",
          title: "Click Confirm to release for production.",
          detail:
            "Both signatures done. Marking the order confirmed unlocks the wizard for MO creation, invoicing, and shipment.",
          primary_cta: %{
            label: "Mark confirmed",
            kind: "action",
            action: "confirm",
            href: "/sales/orders/#{co.uuid}"
          },
          secondary_ctas: []
        }
    end
  end

  defp next_action_for(:production_planning, co, line_states, _mos) do
    missing = Enum.filter(line_states, &(&1.needs_mo? and is_nil(&1.primary_mo)))

    case missing do
      [first | _] ->
        %{
          code: "create_mo",
          title:
            "Create the manufacturing order for #{first.item_name}.",
          detail:
            line_summary(first) <>
              ". The wizard pre-fills the item + qty; you pick the BOM, routing, and dates.",
          primary_cta: %{
            label: "Create MO from this line",
            kind: "action",
            action: "create_mo_for_line",
            line_uuid: first.uuid,
            href: "/sales/orders/#{co.uuid}/wizard"
          },
          secondary_ctas:
            for line <- Enum.drop(missing, 1) do
              %{
                label: "Create MO for #{line.item_name}",
                kind: "action",
                action: "create_mo_for_line",
                line_uuid: line.uuid
              }
            end
        }

      [] ->
        %{
          code: "next_phase",
          title: "All lines have an MO — moving to ingredients.",
          detail: nil,
          primary_cta: nil,
          secondary_ctas: []
        }
    end
  end

  defp next_action_for(:awaiting_ingredients, co, _line_states, mos) do
    blocked_mos = Enum.filter(mos, & &1.has_placeholder_bookings?)
    po_uuids = blocked_mos |> Enum.flat_map(& &1.placeholder_po_uuids) |> Enum.uniq()

    pos =
      from(po in PurchaseOrder,
        where: po.uuid in ^po_uuids,
        order_by: [asc: po.expected_delivery_date, asc: po.id],
        select: %{
          uuid: po.uuid,
          status: po.status,
          expected_delivery_date: po.expected_delivery_date,
          id: po.id
        }
      )
      |> Repo.all()

    case pos do
      [next_po | _] ->
        %{
          code: "chase_po",
          title:
            "Awaiting #{Enum.count(po_uuids)} purchase order(s) before production can start.",
          detail:
            "Next expected delivery: #{format_date(next_po.expected_delivery_date) || "no date set"}. Chase the vendor or update the expected date.",
          primary_cta: %{
            label: "Open next PO",
            kind: "link",
            href: "/procurement/purchase-orders/#{next_po.uuid}"
          },
          secondary_ctas:
            for po <- Enum.drop(pos, 1) do
              %{
                label: "Open PO ##{po.id}",
                kind: "link",
                href: "/procurement/purchase-orders/#{po.uuid}"
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

  defp next_action_for(:in_production, _co, _line_states, mos) do
    # Pick the most-blocked / earliest MO to surface as the action.
    active = Enum.reject(mos, &(&1.status == "completed"))

    candidate =
      Enum.min_by(active, &mo_priority/1, fn -> List.first(active) end)

    title =
      case candidate.status do
        "draft" -> "Prepare MO #{candidate.code}."
        "prepared" -> "Approve MO #{candidate.code} (scientist signature)."
        "approved" -> "Schedule MO #{candidate.code} on the production calendar."
        "scheduled" -> "Start MO #{candidate.code} on the floor."
        "in_progress" -> "MO #{candidate.code} is running — finish it on the floor."
        _ -> "Move MO #{candidate.code} forward."
      end

    %{
      code: "advance_mo",
      title: title,
      detail:
        candidate.broken_booking_count > 0 &&
          "Heads up: #{candidate.broken_booking_count} broken booking(s). Fix before running.",
      primary_cta: %{
        label: "Open MO #{candidate.code}",
        kind: "link",
        href: "/production/manufacturing-orders/#{candidate.uuid}"
      },
      secondary_ctas:
        for mo <- Enum.reject(active, &(&1.id == candidate.id)) do
          %{
            label: "Open MO #{mo.code}",
            kind: "link",
            href: "/production/manufacturing-orders/#{mo.uuid}"
          }
        end,
      scheduler_link: %{
        label: "Open scheduler",
        href: "/production/schedule"
      }
    }
  end

  defp next_action_for(:closeout, _co, _line_states, mos) do
    needs_closeout = Enum.filter(mos, & &1.has_output_at_production_feed?)
    target = List.first(needs_closeout)

    %{
      code: "run_closeout",
      title:
        "Run closeout for MO #{target.code} — move output back to warehouse.",
      detail:
        "Production is finished but the output lot is still at the production-feed cell. The warehouse team scans it back to a storage cell on mobile.",
      primary_cta: %{
        label: "Open mobile closeout",
        kind: "link",
        href: "/m/closeout/#{target.uuid}"
      },
      secondary_ctas:
        for mo <- Enum.drop(needs_closeout, 1) do
          %{
            label: "Closeout MO #{mo.code}",
            kind: "link",
            href: "/m/closeout/#{mo.uuid}"
          }
        end
    }
  end

  defp next_action_for(:ready_to_dispatch, co, _, _) do
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

  defp line_state(_co, %CustomerOrderLine{} = line) do
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

    %{
      uuid: line.uuid,
      id: line.id,
      item_id: line.item_id,
      item_name: line.item && line.item.name,
      qty_ordered: line.qty_ordered,
      mos: mos,
      primary_mo: primary_mo,
      needs_mo?: needs_mo?
    }
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
    mo = Repo.preload(mo, [:item, bookings: []])

    placeholder_bookings =
      Enum.filter(mo.bookings, &(not is_nil(&1.purchase_order_line_id)))

    placeholder_po_uuids =
      placeholder_bookings
      |> Enum.map(& &1.purchase_order_line_id)
      |> Enum.uniq()
      |> po_uuids_for_line_ids()

    output_lots = output_lots_for_mo(mo)
    feed_lots = Enum.filter(output_lots, & &1.at_production_feed?)
    warehouse_lots = output_lots -- feed_lots

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
      has_placeholder_bookings?: placeholder_bookings != [],
      placeholder_po_uuids: placeholder_po_uuids,
      broken_booking_count: count_broken_bookings(mo.bookings),
      output_lots: Enum.map(output_lots, &lot_summary/1),
      output_lot_count: length(output_lots),
      output_at_feed_count: length(feed_lots),
      output_in_warehouse_count: length(warehouse_lots),
      has_output_at_production_feed?:
        mo.status == "completed" and feed_lots != [],
      purchasing_requested_at: mo.purchasing_requested_at,
      due_date: mo.due_date
    }
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

  defp count_broken_bookings([]), do: 0

  defp count_broken_bookings(bookings) do
    # A booking is "broken" when its stock_lot is no longer placed at
    # a cell, OR when the qty available has dropped below qty
    # required. Conservative V1: only count bookings flagged as
    # `is_broken` on the booking row if such a field exists; else 0.
    Enum.count(bookings, fn b ->
      Map.get(b, :is_broken) == true
    end)
  end

  defp output_lots_for_mo(%ManufacturingOrder{id: mo_id}) do
    # Lots created by this MO have source_kind = "manufacturing_order"
    # and source_ref = "<mo.id>". We also include the MO's own
    # produced_lot_id as a fallback in case some lot's source_ref
    # got cleared.
    source_ref = Integer.to_string(mo_id)

    lots =
      from(l in Lot,
        where:
          l.source_kind == "manufacturing_order" and
            l.source_ref == ^source_ref,
        preload: [placements: [storage_cell: []]]
      )
      |> Repo.all()

    Enum.map(lots, &lot_with_placement/1)
  end

  defp lot_with_placement(%Lot{} = lot) do
    feed? =
      Enum.any?(lot.placements, fn p ->
        p.storage_cell && p.storage_cell.purpose == "production_feed"
      end)

    %{
      id: lot.id,
      uuid: lot.uuid,
      status: lot.status,
      qty_received: lot.qty_received,
      placements: lot.placements,
      at_production_feed?: feed?
    }
  end

  defp lot_summary(%{} = lot_state) do
    %{
      uuid: lot_state.uuid,
      status: lot_state.status,
      qty: lot_state.qty_received,
      at_production_feed?: lot_state.at_production_feed?
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

  defp timeline(co, mos) do
    co_events =
      [
        co.inserted_at && %{at: co.inserted_at, label: "Order created", scope: "co"},
        co.submitted_at && %{at: co.submitted_at, label: "Submitted for approval", scope: "co"},
        co.confirmed_at && %{at: co.confirmed_at, label: "Confirmed — released for production", scope: "co"},
        co.cancelled_at && %{at: co.cancelled_at, label: "Cancelled", scope: "co"}
      ]
      |> Enum.reject(&is_nil/1)

    mo_events =
      Enum.flat_map(mos, fn mo ->
        [
          %{
            at: nil,
            label: "MO #{mo.code} created",
            scope: "mo",
            mo_uuid: mo.uuid
          }
        ]
      end)

    (co_events ++ mo_events)
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

  defp mo_priority(%{status: status, has_placeholder_bookings?: pb, broken_booking_count: bb}) do
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

    blocker_priority + status_priority
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
