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

  alias Backend.Companies
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

  # CSV cells that contain the separator, quotes, or newlines must be
  # quoted with double-quotes per RFC 4180; embedded quotes get
  # doubled.
  defp csv_escape(value, sep) do
    s = to_string(value)

    if String.contains?(s, [sep, "\"", "\n", "\r"]) do
      "\"" <> String.replace(s, "\"", "\"\"") <> "\""
    else
      s
    end
  end
end
