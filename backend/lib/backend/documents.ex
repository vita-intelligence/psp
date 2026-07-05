defmodule Backend.Documents do
  @moduledoc """
  PO document rendering: internal PDF, vendor PDF, delivery note, RFQ,
  and CSV — all the formats surfaced on the PO detail page's document
  toolbar (`MRPEasy`-parity row).

  Company letterhead (name, address, tax/registration numbers, payment
  details, currency formatting) is pulled from `Backend.Companies` so a
  change in `/settings/company` immediately propagates to every new
  document — no extra wiring.

  PDFs use `ChromicPDF` (headless Chrome). The session pool is started
  in `Backend.Application`. We render EEx → HTML → PDF in-memory; no
  temp files. CSV is plain string assembly that respects the company's
  `csv_separator` so non-comma locales survive Excel import.
  """

  import Ecto.Query, warn: false

  alias Backend.Companies
  alias Backend.CustomerInvoices.CustomerInvoice
  alias Backend.Numbering
  alias Backend.Purchasing.PurchaseOrder

  @templates_dir Path.join([
                   :code.priv_dir(:backend) |> to_string(),
                   "templates",
                   "documents"
                 ])

  @print_opts [
    print_to_pdf: %{
      preferCSSPageSize: true,
      printBackground: true,
      marginTop: 0.4,
      marginBottom: 0.4,
      marginLeft: 0.4,
      marginRight: 0.4
    }
  ]

  # NOTE: the ChromicPDF render timeout is bumped at supervisor boot
  # in `Backend.Application.chromic_pdf_child/0` via
  # `session_pool: [timeout: 60_000]`. Per-request `:timeout` opts to
  # `print_to_pdf/2` do NOT override that value.

  @doc """
  Render the PO PDF for the given `audience`:

    * `:internal` — full doc with internal cost breakdown + notes
    * `:vendor`   — clean version, hides internal notes / margin info

  Returns `{:ok, binary_pdf}`. PO must be preloaded with `:vendor` +
  `lines: [:item]`; callers can use `Backend.Purchasing.get_for_company/2`
  which does that already.
  """
  def purchase_order_pdf(%PurchaseOrder{} = po, audience: audience)
      when audience in [:internal, :vendor] do
    company = Companies.current()
    assigns = po_assigns(po, company, audience: audience)
    render_pdf("purchase_order.html.eex", assigns)
  end

  @doc """
  Delivery note PDF — quantities + items only, no prices. Customers
  who self-collect or vendors who include a packing list use this.
  """
  def delivery_note_pdf(%PurchaseOrder{} = po) do
    company = Companies.current()
    assigns = po_assigns(po, company, audience: :vendor)
    render_pdf("delivery_note.html.eex", assigns)
  end

  @doc """
  RFQ (Request For Quote) PDF — same line set with prices blanked out
  so vendors can quote against it. Useful before the PO is firm.
  """
  def rfq_pdf(%PurchaseOrder{} = po) do
    company = Companies.current()
    assigns = po_assigns(po, company, audience: :vendor)
    render_pdf("rfq.html.eex", assigns)
  end

  @doc """
  CSV of the PO lines using the company's configured separator.
  Header row + one row per line. Returns the iodata as a binary so
  controllers can stream it directly.
  """
  def purchase_order_csv(%PurchaseOrder{} = po) do
    company = Companies.current()
    sep = company.csv_separator || ","

    header = [
      "Line",
      "Item code",
      "Item name",
      "Qty ordered",
      "Unit price",
      "Currency",
      "Line subtotal",
      "Expected delivery",
      "Vendor part no",
      "Notes"
    ]

    rows =
      po.lines
      |> Enum.with_index(1)
      |> Enum.map(fn {l, i} ->
        [
          Integer.to_string(i),
          item_code(l.item, company),
          (l.item && l.item.name) || "",
          decimal_to_string(l.qty_ordered),
          decimal_to_string(l.unit_price),
          po.currency_code || company.currency_code || "GBP",
          decimal_to_string(l.line_subtotal),
          date_to_string(l.expected_delivery_date),
          l.vendor_part_no || "",
          l.notes || ""
        ]
      end)

    [header | rows]
    |> Enum.map(&Enum.map_join(&1, sep, fn cell -> csv_escape(cell, sep) end))
    |> Enum.join("\r\n")
    |> Kernel.<>("\r\n")
  end

  @doc """
  Customer invoice PDF. Same ChromicPDF posture as PO documents —
  EEx → HTML → headless Chrome → bytes. Caller is responsible for
  preloading the invoice with `customer`, `customer_order`, `lines`
  (with item), `payments` (the standard `get_for_company/2` shape
  already does this).

  Returns `{:ok, binary_pdf}`.
  """
  def customer_invoice_pdf(%CustomerInvoice{} = inv) do
    company = Companies.current()
    assigns = invoice_assigns(inv, company)
    render_pdf("customer_invoice.html.eex", assigns)
  end

  @doc """
  Pre-filled mailto subject + body for the Send PO / Send RFQ / Send
  note buttons. The FE constructs the `mailto:` URL from these so the
  user's own mail client opens — same UX as MRPEasy. We don't send
  server-side; the user previews / edits / sends from their client.

  `kind` is `:po | :rfq | :note`. Returns `%{to, subject, body}`.
  """
  def mailto_payload(%PurchaseOrder{} = po, actor, kind) do
    company = Companies.current()
    po_code = Numbering.render(po.id, company, "purchase_order") || "PO##{po.id}"
    contact = vendor_contact_first_name(po.vendor)
    signer = actor.name || company.name || ""
    org = company.name || ""

    {subject, body} =
      case kind do
        :po ->
          {
            "Purchase order #{po_code} from #{org}",
            """
            Hi #{contact},

            Please find attached our purchase order #{po_code}. Confirm
            receipt and expected dispatch date at your convenience.

            Thank you,
            #{signer}
            #{org}
            """
          }

        :rfq ->
          {
            "Request for quote #{po_code} from #{org}",
            """
            Hi #{contact},

            Please find attached our request for quote. We would
            appreciate your pricing and lead time for the items listed
            at your earliest convenience.

            Thank you,
            #{signer}
            #{org}
            """
          }

        :note ->
          {
            "Re #{po_code}",
            """
            Hi #{contact},



            Thank you,
            #{signer}
            #{org}

            ─────
            In reference to #{po_code}.
            """
          }
      end

    %{
      to: (po.vendor && po.vendor.email) || "",
      subject: subject,
      body: body
    }
  end

  @doc """
  Batch Manufacturing Record PDF — assembled from the parent MO's
  data: BOM, materials consumed (bookings), routing operations
  (steps), output lots, and the sign-off chain (preparer, approver,
  picker, closeout operator, output QC). Attached to the release row
  as the required `bmr` evidence file (BRCGS Issue 9 § 3.9 + § 5.6).

  `release` MUST come preloaded with :manufacturing_order (bom, lines,
  bookings with item + stock_lot + picked_by + consumed_by, steps),
  :stock_lot (:item). The caller in
  `Backend.Production.FinalReleases.generate_bmr/2` does that.
  """
  def production_bmr_pdf(release) do
    company = Companies.current()
    assigns = bmr_assigns(release, company)
    render_pdf("production_bmr.html.eex", assigns)
  end

  defp bmr_assigns(release, company) do
    mo = release.manufacturing_order
    lot = release.stock_lot
    item = lot && lot.item

    # Flatten the MO tree bottom-up (children first, root last) — the
    # order production actually ran. Each entry becomes its own section
    # in the report so the auditor sees the full "raw → semi → final"
    # provenance instead of just the top-of-tree MO's bookings.
    mo_chain =
      mo
      |> collect_mo_chain()
      |> Enum.map(&mo_section(&1, company))

    top_output_lots =
      Backend.Repo.all(
        from l in Backend.Stock.Lot,
          where:
            l.source_kind == "manufacturing_order" and
              l.source_ref == ^(mo && mo.uuid || "")
      )

    output_rows = Enum.map(top_output_lots, &output_lot_row(&1, company))

    # Quality checks — three gates the batch cleared before dispatch:
    #   1. Goods-in inspection on each raw-material lot that fed
    #      any MO in the tree (per BRCGS § 3.5).
    #   2. Preflight receipt sign-off on every booking (operator
    #      confirmed qty + quality at the production-feed cell
    #      before the run started).
    #   3. Output QC verdict on every produced lot (sub-MO
    #      semi-finished + top-of-tree output).
    quality = quality_checks(mo_chain_raw(mo), top_output_lots, company)

    lot_code = Backend.Numbering.render(lot.id, company, "stock_lot") || "#{lot.id}"
    mo_code = Backend.Numbering.render(mo.id, company, "manufacturing_order") || "#{mo.id}"

    %{
      company: company,
      now: format_date_time(DateTime.utc_now()),
      batch_ref: "#{mo_code} · #{lot_code}",
      product_name: (item && item.name) || "—",
      product_type: (item && humanize_item_type(item.item_type)) || "—",
      lot_code: lot_code,
      mo_code: mo_code,
      batch_qty: format_decimal(lot.qty_received),
      batch_uom: uom_symbol(item),
      bom_ref: bom_ref(mo),
      manufactured_at: format_date(lot.manufactured_at),
      expiry_at: format_date(lot.expiry_at),
      mo_chain: mo_chain,
      output_lots: output_rows,
      goods_in_checks: quality.goods_in,
      preflight_checks: quality.preflight,
      output_qc_checks: quality.output_qc,
      signoffs: bmr_signoffs(release, mo_chain)
    }
  end

  # Same tree walk as collect_mo_chain/1 but returns the raw MO
  # structs so we can pull their bookings' stock_lot_ids for the
  # photo query (collect_mo_chain returns sections already mapped
  # for the template).
  defp mo_chain_raw(nil), do: []

  defp mo_chain_raw(mo) do
    children =
      case Map.get(mo, :children) do
        list when is_list(list) -> Enum.flat_map(list, &mo_chain_raw/1)
        _ -> []
      end

    children ++ [mo]
  end

  # Depth-first collection of the whole MO tree, children BEFORE
  # parent, so the report reads chronologically: raw material MO
  # first, semi-finished intermediate MO second, packaged / labelled
  # final MO last.
  defp collect_mo_chain(nil), do: []

  defp collect_mo_chain(mo) do
    children =
      case Map.get(mo, :children) do
        list when is_list(list) -> Enum.flat_map(list, &collect_mo_chain/1)
        _ -> []
      end

    children ++ [mo]
  end

  defp mo_section(mo, company) do
    materials =
      case mo.bookings do
        list when is_list(list) ->
          list
          |> Enum.sort_by(& &1.id)
          |> Enum.map(&booking_row(&1, company))

        _ ->
          []
      end

    operations =
      case mo.steps do
        list when is_list(list) ->
          list
          |> Enum.sort_by(& &1.sort_order)
          |> Enum.map(&step_row/1)

        _ ->
          []
      end

    output_lots =
      Backend.Repo.all(
        from l in Backend.Stock.Lot,
          where:
            l.source_kind == "manufacturing_order" and
              l.source_ref == ^mo.uuid
      )

    parent_ref =
      case mo.parent_mo_id do
        nil ->
          "Top-of-tree (final product)"

        _ ->
          "Feeds parent MO"
      end

    role_label =
      case Map.get(mo.bom || %{}, :output_kind) do
        _ ->
          if is_nil(mo.parent_mo_id),
            do: "Final assembly / packaging",
            else: "Sub-MO — semi-finished input"
      end

    mo_code = Backend.Numbering.render(mo.id, company, "manufacturing_order") || "##{mo.id}"

    signoffs = [
      %{
        role: "#{mo_code} prepared",
        name: actor_name(mo.prepared_by),
        when: when_stamp(mo.prepared_at)
      },
      %{
        role: "#{mo_code} approved",
        name: actor_name(mo.approved_by),
        when: when_stamp(mo.approved_at)
      },
      %{
        role: "#{mo_code} finish",
        name: if(mo.actual_finish, do: "Recorded", else: nil),
        when: when_stamp(mo.actual_finish)
      }
    ]

    # Planned window is derived from the min/max of the steps' planned
    # times — the MO itself only stores actual_start / actual_finish.
    steps = case mo.steps do
      list when is_list(list) -> list
      _ -> []
    end

    # Photos live in a dedicated top-level section (see
    # `product_history_photos/2`), not on the per-MO card, so the
    # audit story reads as one merged timeline instead of scattered
    # sub-grids.

    planned_start =
      steps
      |> Enum.map(& &1.planned_start)
      |> Enum.reject(&is_nil/1)
      |> Enum.min(fn -> nil end)

    planned_finish =
      steps
      |> Enum.map(& &1.planned_finish)
      |> Enum.reject(&is_nil/1)
      |> Enum.max(fn -> nil end)

    %{
      code: mo_code,
      output_item: (mo.item && mo.item.name) || "—",
      quantity: format_decimal(mo.quantity),
      role_label: role_label,
      parent_ref: parent_ref,
      status: humanize_lot_status(mo.status),
      planned_window: format_window(planned_start, planned_finish),
      actual_window: format_window(mo.actual_start, mo.actual_finish),
      materials: materials,
      operations: operations,
      output_lots: Enum.map(output_lots, &output_lot_row(&1, company)),
      signoffs: signoffs
    }
  end

  # Three QC gates the batch cleared. Each returns a list of rows for
  # the template's tables. Empty lists render as "None recorded" so
  # the auditor sees the section deliberately covered every stage.
  defp quality_checks(mo_chain_raw, top_output_lots, company) do
    bookings =
      Enum.flat_map(mo_chain_raw, fn mo ->
        case mo.bookings do
          list when is_list(list) -> list
          _ -> []
        end
      end)

    input_lot_ids =
      bookings
      |> Enum.map(& &1.stock_lot_id)
      |> Enum.reject(&is_nil/1)
      |> Enum.uniq()

    all_output_lot_ids =
      case mo_chain_raw do
        [] ->
          Enum.map(top_output_lots, & &1.id)

        _ ->
          uuids = Enum.map(mo_chain_raw, & &1.uuid)

          Backend.Repo.all(
            from l in Backend.Stock.Lot,
              where:
                l.source_kind == "manufacturing_order" and
                  l.source_ref in ^uuids,
              select: l.id
          )
      end

    %{
      goods_in: goods_in_rows(input_lot_ids, company),
      preflight: preflight_rows(bookings, mo_chain_raw, company),
      output_qc: output_qc_rows(all_output_lot_ids, mo_chain_raw, company)
    }
  end

  # For each raw-material lot the tree consumed, find its parent PO
  # and the goods-in inspection that cleared the delivery.
  defp goods_in_rows([], _company), do: []

  defp goods_in_rows(lot_ids, company) do
    lots =
      Backend.Repo.all(
        from l in Backend.Stock.Lot,
          where:
            l.id in ^lot_ids and
              l.source_kind == "purchase_order" and
              not is_nil(l.source_ref),
          preload: [:item],
          select: {l, l.source_ref}
      )

    if lots == [] do
      []
    else
      # PO source_ref is the rendered code (e.g. "PO00168"). Reverse
      # to the id via Numbering.parse_search, then batch-fetch the
      # inspections keyed by po_id.
      po_ids =
        lots
        |> Enum.map(fn {_, ref} ->
          Backend.Numbering.parse_search(ref, company, "purchase_order")
        end)
        |> Enum.reject(&is_nil/1)
        |> Enum.uniq()

      inspections =
        if po_ids == [] do
          %{}
        else
          Backend.Repo.all(
            from i in Backend.GoodsIn.Inspection,
              where: i.purchase_order_id in ^po_ids and i.status != "draft",
              preload: [:quality_approver, :goods_in_operator],
              order_by: [asc: i.delivery_date, asc: i.id]
          )
          |> Enum.group_by(& &1.purchase_order_id)
        end

      Enum.flat_map(lots, fn {lot, source_ref} ->
        po_id =
          Backend.Numbering.parse_search(source_ref, company, "purchase_order")

        case Map.get(inspections, po_id, []) do
          [] ->
            [
              %{
                item_name: (lot.item && lot.item.name) || "—",
                lot_code:
                  Backend.Numbering.render(lot.id, company, "stock_lot") ||
                    "##{lot.id}",
                supplier_batch: lot.supplier_batch_no || "—",
                po_code: source_ref || "—",
                delivery_date: "—",
                decision: "No inspection on file",
                decision_tone: "muted",
                decision_bg: decision_bg("muted"),
                decision_fg: decision_fg("muted"),
                approver: "—",
                signed_at: ""
              }
            ]

          inspection_list ->
            Enum.map(inspection_list, fn ins ->
              tone = gi_decision_tone(ins.quality_decision)

              %{
                item_name: (lot.item && lot.item.name) || "—",
                lot_code:
                  Backend.Numbering.render(lot.id, company, "stock_lot") ||
                    "##{lot.id}",
                supplier_batch: lot.supplier_batch_no || "—",
                po_code: source_ref || "—",
                delivery_date: format_date(ins.delivery_date),
                decision: humanize_gi_decision(ins.quality_decision),
                decision_tone: tone,
                decision_bg: decision_bg(tone),
                decision_fg: decision_fg(tone),
                approver: actor_name(ins.quality_approver),
                signed_at: format_date_time(ins.quality_approver_signed_at)
              }
            end)
        end
      end)
    end
  end

  # Tone → chip colour. Precomputed per row so the template stays
  # simple string-interpolation.
  defp decision_bg("good"), do: "#dff5e3"
  defp decision_bg("warn"), do: "#fff2d6"
  defp decision_bg("bad"), do: "#fbe0de"
  defp decision_bg(_), do: "#eee"

  defp decision_fg("good"), do: "#1f6a2b"
  defp decision_fg("warn"), do: "#7a5510"
  defp decision_fg("bad"), do: "#8f2b26"
  defp decision_fg(_), do: "#555"

  defp humanize_gi_decision(nil), do: "—"
  defp humanize_gi_decision("approved"), do: "Approved"
  defp humanize_gi_decision("hold"), do: "Hold"
  defp humanize_gi_decision("rejected"), do: "Rejected"
  defp humanize_gi_decision(other) when is_binary(other), do: String.capitalize(other)
  defp humanize_gi_decision(_), do: "—"

  defp gi_decision_tone("approved"), do: "good"
  defp gi_decision_tone("hold"), do: "warn"
  defp gi_decision_tone("rejected"), do: "bad"
  defp gi_decision_tone(_), do: "muted"

  # Preflight receipt sign-offs per booking. Each row = "operator
  # confirmed this ingredient at the production feed before the
  # run started". `received_at` nil means the booking never cleared
  # preflight (shouldn't happen for a completed MO, but surface as
  # "Missing" if it does).
  defp preflight_rows([], _mos, _company), do: []

  defp preflight_rows(bookings, mo_chain_raw, company) do
    mo_code_by_id =
      Enum.into(mo_chain_raw, %{}, fn mo ->
        {mo.id,
         Backend.Numbering.render(mo.id, company, "manufacturing_order") ||
           "##{mo.id}"}
      end)

    bookings
    |> Enum.sort_by(& &1.received_at, fn a, b -> compare_dt(a, b) end)
    |> Enum.map(fn b ->
      %{
        mo_code: Map.get(mo_code_by_id, b.manufacturing_order_id, "—"),
        item_name: (b.item && b.item.name) || "—",
        lot_code: booking_lot_code(b, company),
        received_qty: format_decimal(b.received_qty || b.quantity),
        received_by: actor_name(b.received_by),
        received_at: format_date_time(b.received_at),
        notes: b.received_notes,
        cleared?: not is_nil(b.received_at)
      }
    end)
  end

  defp booking_lot_code(%{stock_lot: %{id: id}}, company) do
    Backend.Numbering.render(id, company, "stock_lot") || "##{id}"
  end

  defp booking_lot_code(_, _), do: "—"

  # Fallback: booking schema might not have :received_by preloaded on
  # every code path. Actor_name/1 handles nil.

  # Nil timestamps sort last.
  defp compare_dt(nil, nil), do: false
  defp compare_dt(nil, _), do: false
  defp compare_dt(_, nil), do: true
  defp compare_dt(a, b), do: NaiveDateTime.compare(a, b) != :gt

  # Output QC — walk lot lifecycle events for every produced lot in
  # the tree, take the last `qc_passed` / `output_qc_passed` /
  # `qc_failed`, and record the verdict + signer.
  defp output_qc_rows([], _mos, _company), do: []

  defp output_qc_rows(lot_ids, mo_chain_raw, company) do
    mo_code_by_uuid =
      Enum.into(mo_chain_raw, %{}, fn mo ->
        {mo.uuid,
         Backend.Numbering.render(mo.id, company, "manufacturing_order") ||
           "##{mo.id}"}
      end)

    lots =
      Backend.Repo.all(
        from l in Backend.Stock.Lot,
          where: l.id in ^lot_ids,
          preload: [:item]
      )

    events =
      Backend.Repo.all(
        from e in Backend.Stock.LotEvent,
          where:
            e.stock_lot_id in ^lot_ids and
              e.kind in ["qc_passed", "output_qc_passed", "qc_failed"],
          order_by: [asc: e.occurred_at, asc: e.id],
          preload: [:actor]
      )
      |> Enum.group_by(& &1.stock_lot_id)

    Enum.map(lots, fn lot ->
      history = Map.get(events, lot.id, [])
      latest = List.last(history)

      {verdict, tone} =
        case latest do
          nil -> {"Pending", "muted"}
          %{kind: "qc_failed"} -> {"Rejected", "bad"}
          _ -> {"Passed", "good"}
        end

      %{
        mo_code: Map.get(mo_code_by_uuid, lot.source_ref, "—"),
        item_name: (lot.item && lot.item.name) || "—",
        lot_code:
          Backend.Numbering.render(lot.id, company, "stock_lot") || "##{lot.id}",
        verdict: verdict,
        verdict_tone: tone,
        verdict_bg: decision_bg(tone),
        verdict_fg: decision_fg(tone),
        operator: actor_name(latest && latest.actor),
        signed_at: (latest && format_date_time(latest.occurred_at)) || ""
      }
    end)
  end

  defp booking_row(b, company) do
    %{
      item_name: (b.item && b.item.name) || "—",
      lot_code:
        (b.stock_lot &&
           (Backend.Numbering.render(b.stock_lot.id, company, "stock_lot") ||
              "##{b.stock_lot.id}")) ||
          "—",
      supplier_batch:
        (b.stock_lot && b.stock_lot.supplier_batch_no) || "—",
      booked_qty: format_decimal(b.quantity),
      consumed_qty: format_decimal(b.consumed_quantity),
      picked_by:
        actor_name(b.picked_by) <> when_stamp(b.picked_at),
      consumed_by:
        actor_name(b.consumed_by) <> when_stamp(b.consumed_at)
    }
  end

  defp step_row(step) do
    %{
      description: step.operation_description || "—",
      workstation:
        (Map.get(step, :workstation_group) && step.workstation_group.name) ||
          "—",
      planned_window:
        format_window(step.planned_start, step.planned_finish),
      actual_window:
        format_window(step.actual_start, step.actual_finish)
    }
  end

  defp output_lot_row(lot, company) do
    %{
      lot_code:
        Backend.Numbering.render(lot.id, company, "stock_lot") || "##{lot.id}",
      supplier_batch: lot.supplier_batch_no || "—",
      qty: format_decimal(lot.qty_received),
      status: humanize_lot_status(lot.status)
    }
  end

  # Sign-offs cover EVERY MO in the chain (each has its own preparer /
  # approver + optional production-finish stamp) plus the final release
  # ceremony at the top. Presented in the same chronological order as
  # the sections above so the audit trail reads left-to-right.
  defp bmr_signoffs(release, mo_chain) do
    per_mo =
      Enum.flat_map(mo_chain, fn section ->
        # `section` is the map returned by mo_section/2, so it doesn't
        # carry the raw MO struct. We stash the actors on the section
        # too — see mo_section/2's expanded return value below.
        Map.get(section, :signoffs, [])
      end)

    release_signoffs = [
      %{
        role: "Release: releaser",
        name: actor_name(release.releaser),
        when: when_stamp(release.releaser_signed_at)
      },
      %{
        role: "Release: approver",
        name: actor_name(release.approver),
        when: when_stamp(release.approver_signed_at)
      },
      %{
        role: "Release: decision",
        name: humanize_release_status(release.status),
        when: when_stamp(release.finalized_at)
      }
    ]

    per_mo ++ release_signoffs
  end

  defp actor_name(nil), do: "—"
  defp actor_name(%{name: n}) when is_binary(n) and n != "", do: n
  defp actor_name(%{email: e}) when is_binary(e), do: e
  defp actor_name(_), do: "—"

  defp when_stamp(nil), do: ""

  defp when_stamp(%DateTime{} = dt),
    do: " · " <> format_date_time(dt)

  defp when_stamp(%NaiveDateTime{} = ndt) do
    " · " <>
      (ndt |> DateTime.from_naive!("Etc/UTC") |> format_date_time())
  end

  defp when_stamp(_), do: ""

  defp bom_ref(nil), do: "—"

  defp bom_ref(mo) do
    case mo.bom do
      %{code: code, revision: rev} when is_binary(code) ->
        code <> if(is_binary(rev), do: " · rev " <> rev, else: "")

      %{revision: rev} when is_binary(rev) ->
        "rev " <> rev

      _ ->
        "—"
    end
  end

  defp humanize_item_type(nil), do: "—"

  defp humanize_item_type(t) when is_binary(t) do
    t
    |> String.replace("_", " ")
    |> String.split(" ")
    |> Enum.map_join(" ", &String.capitalize/1)
  end

  defp humanize_lot_status(nil), do: "—"
  defp humanize_lot_status(s), do: String.replace(s, "_", " ")

  defp humanize_release_status("pending"), do: "Pending"
  defp humanize_release_status("released"), do: "Released"
  defp humanize_release_status("on_hold"), do: "On hold"
  defp humanize_release_status("rejected"), do: "Rejected"
  defp humanize_release_status(other) when is_binary(other), do: other
  defp humanize_release_status(_), do: "—"

  defp uom_symbol(nil), do: ""

  defp uom_symbol(item) do
    case Map.get(item, :stock_uom) do
      %{symbol: s} when is_binary(s) -> s
      _ -> ""
    end
  end

  defp format_decimal(nil), do: "—"

  defp format_decimal(%Decimal{} = d),
    do: d |> Decimal.to_string(:normal)

  defp format_decimal(n) when is_number(n), do: to_string(n)
  defp format_decimal(_), do: "—"

  defp format_date(nil), do: "—"

  defp format_date(%Date{} = d),
    do: Calendar.strftime(d, "%Y-%m-%d")

  defp format_date(%DateTime{} = dt),
    do: Calendar.strftime(dt, "%Y-%m-%d")

  defp format_date(%NaiveDateTime{} = ndt),
    do: Calendar.strftime(ndt, "%Y-%m-%d")

  defp format_date(_), do: "—"

  defp format_date_time(%DateTime{} = dt),
    do: Calendar.strftime(dt, "%Y-%m-%d %H:%M UTC")

  defp format_date_time(%NaiveDateTime{} = ndt) do
    ndt |> DateTime.from_naive!("Etc/UTC") |> format_date_time()
  end

  defp format_date_time(_), do: "—"

  defp format_window(nil, nil), do: "—"

  defp format_window(a, b) do
    "#{format_date_time(a)} → #{format_date_time(b)}"
  end

  # ---------------------------------------------------------------- private

  defp render_pdf(template, assigns) do
    html =
      @templates_dir
      |> Path.join(template)
      |> EEx.eval_file(assigns: assigns)

    {:ok, base64} = ChromicPDF.print_to_pdf({:html, html}, @print_opts)
    {:ok, Base.decode64!(base64)}
  end

  defp po_assigns(%PurchaseOrder{} = po, company, opts) do
    audience = Keyword.fetch!(opts, :audience)
    currency = po.currency_code || company.currency_code || "GBP"

    %{
      po: po,
      company: company,
      vendor: po.vendor,
      lines: po.lines || [],
      audience: audience,
      audience_label: audience_label(audience),
      currency: currency,
      po_code: Numbering.render(po.id, company, "purchase_order") || "PO##{po.id}",
      now: Date.utc_today() |> Date.to_string(),
      logo_path: nil,
      format_money: fn d -> format_money(d, currency, company) end,
      format_qty: fn d -> decimal_to_string(d) end,
      format_date: fn d -> date_to_string(d) end,
      item_code: fn item -> item_code(item, company) end
    }
  end

  defp audience_label(:internal), do: "Internal copy"
  defp audience_label(:vendor), do: ""

  defp invoice_assigns(%CustomerInvoice{} = inv, company) do
    currency = inv.currency_code || company.currency_code || "GBP"
    paid =
      Enum.reduce(inv.payments || [], Decimal.new(0), fn p, acc ->
        Decimal.add(acc, p.amount || Decimal.new(0))
      end)

    outstanding = Decimal.sub(inv.grand_total || Decimal.new(0), paid)

    %{
      invoice: inv,
      company: company,
      customer: inv.customer,
      customer_order: inv.customer_order,
      lines: inv.lines || [],
      payments: inv.payments || [],
      paid: paid,
      outstanding: outstanding,
      currency: currency,
      invoice_code:
        Numbering.render(inv.id, company, "customer_invoice") || "INV##{inv.id}",
      now: Date.utc_today() |> Date.to_string(),
      format_money: fn d -> format_money(d, currency, company) end,
      format_qty: fn d -> decimal_to_string(d) end,
      format_date: fn d -> date_to_string(d) end,
      item_code: fn item -> item_code(item, company) end,
      doc_title: invoice_doc_title(inv.kind),
      status_label: invoice_status_label(inv.kind, inv.status)
    }
  end

  defp invoice_doc_title("credit_note"), do: "Credit Note"
  defp invoice_doc_title("proforma"), do: "Proforma Invoice"
  defp invoice_doc_title("quotation"), do: "Quotation"
  defp invoice_doc_title(_), do: "Invoice"

  defp invoice_status_label("credit_note", "draft"), do: "Credit note (draft)"
  defp invoice_status_label("credit_note", _), do: "Credit Note — Issued"
  defp invoice_status_label(_kind, "draft"), do: "Draft (not yet issued)"
  defp invoice_status_label(_kind, "sent"), do: "Invoice"
  defp invoice_status_label(_kind, "partially_paid"), do: "Invoice — Partially paid"
  defp invoice_status_label(_kind, "paid"), do: "Invoice — Paid"
  defp invoice_status_label(_kind, "cancelled"), do: "Invoice — Cancelled"
  defp invoice_status_label(_kind, other), do: to_string(other)

  defp item_code(nil, _company), do: ""

  defp item_code(item, company) do
    case Numbering.render(item.id, company, "item") do
      nil -> item.external_sku || ""
      code -> code
    end
  end

  defp decimal_to_string(nil), do: ""
  defp decimal_to_string(%Decimal{} = d), do: Decimal.to_string(d, :normal)
  defp decimal_to_string(n) when is_number(n), do: to_string(n)
  defp decimal_to_string(other), do: to_string(other)

  defp date_to_string(nil), do: ""
  defp date_to_string(%Date{} = d), do: Date.to_string(d)
  defp date_to_string(other), do: to_string(other)

  defp format_money(nil, currency, company), do: format_money(Decimal.new(0), currency, company)

  defp format_money(%Decimal{} = d, currency, company) do
    apply_currency_format(money_digits(d, company), currency, company)
  end

  defp format_money(n, currency, company) when is_number(n) do
    apply_currency_format(money_digits(Decimal.from_float(n / 1), company), currency, company)
  end

  # Format the numeric portion with the company's thousands +
  # decimal separators. Two decimals always (PO money precision).
  defp money_digits(%Decimal{} = d, company) do
    rounded = Decimal.round(d, 2)
    [int_part, dec_part] = rounded |> Decimal.to_string(:normal) |> String.split(".", parts: 2)
    thousands = (company && company.thousands_separator) || ","
    decimal = (company && company.decimal_separator) || "."

    grouped =
      int_part
      |> String.to_charlist()
      |> Enum.reverse()
      |> Enum.chunk_every(3)
      |> Enum.map(&Enum.reverse/1)
      |> Enum.reverse()
      |> Enum.map(&List.to_string/1)
      |> Enum.join(thousands)

    grouped <> decimal <> String.pad_trailing(dec_part, 2, "0")
  end

  # Apply the company's `[Sign] [Price]`-style template (or default
  # to "GBP 1,234.56"). Sign is the currency code — same convention
  # the FE uses in `formatCompanyMoney`.
  defp apply_currency_format(price, currency, company) do
    layout = (company && company.currency_format) || "[Sign] [Price]"

    case layout do
      "[Sign] [Price]" -> currency <> " " <> price
      "[Sign][Price]" -> currency <> price
      "[Price] [Sign]" -> price <> " " <> currency
      "[Price][Sign]" -> price <> currency
      _ -> currency <> " " <> price
    end
  end

  defp vendor_contact_first_name(nil), do: "supplier"

  defp vendor_contact_first_name(%{contact_name: name}) when is_binary(name) and name != "" do
    name |> String.split(" ", parts: 2) |> List.first()
  end

  defp vendor_contact_first_name(%{name: name}) when is_binary(name) and name != "", do: name
  defp vendor_contact_first_name(_), do: "supplier"

  # Delegate to the shared escape helper. Kept private here so
  # existing callers don't need to change; the module lives in
  # `Backend.CSV.Escape` so it can be tested standalone.
  defp csv_escape(value, sep), do: Backend.CSV.Escape.escape(value, sep)
end
