defmodule Backend.CustomerInvoices do
  @moduledoc """
  Boundary for customer invoices + lines + payments.

  Sell-side back-half of the order-to-cash cycle. Once a CO reaches
  `confirmed`, invoices generated from it carry the legal obligation
  to pay. Payment tracking is per-invoice with multiple partial
  payments; the credit-limit gate on Customer Orders reads the live
  outstanding A/R off this module via `outstanding_ar_for/1`.

  V1 ships `kind = "invoice"` only — schema + enum already cover
  proforma / credit_note / quotation for later.

  State machine:

      draft → sent → partially_paid → paid    (terminal)
              ↘
                cancelled   (only when no payments recorded)

  Send gates:
    * Customer is effectively approved (Customers.approval_active?)
    * Lines present
    * Grand total > 0

  Payment auto-flip:
    * record_payment + outstanding > 0 ⇒ partially_paid
    * record_payment + outstanding ≤ 0 ⇒ paid
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.Customers
  alias Backend.Customers.Customer
  alias Backend.CustomerOrders.{CustomerOrder, CustomerOrderLine}
  alias Backend.CustomerReturns.CustomerReturn
  alias Backend.CustomerInvoices.{
    CustomerInvoice,
    CustomerInvoiceLine,
    CustomerInvoicePayment
  }
  alias Backend.ListQueries
  alias Backend.Repo

  @invoice_audit_fields ~w(status kind customer_id customer_order_id
                           currency_code subtotal discount_pct discount_amount
                           tax_rate tax_amount grand_total invoice_date due_date
                           billing_address customer_reference free_text
                           sent_at cancelled_at cancellation_reason)a

  @invoice_sortable ~w(id status invoice_date due_date grand_total inserted_at)a
  @invoice_search ~w(customer_reference free_text billing_address)a
  @invoice_default_sort {:invoice_date, :desc}

  # ----- list / get -----------------------------------------------

  def list_page(company_id, opts \\ []) when is_integer(company_id) do
    sort = normalise_sort(Keyword.get(opts, :sort, @invoice_default_sort))

    base =
      CustomerInvoice
      |> where([i], i.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @invoice_search)
      |> maybe_status_filter(opts[:status])
      |> maybe_customer_filter(opts[:customer_id])
      |> ListQueries.apply_column_filters(opts[:column_filter], @invoice_sortable)
      |> ListQueries.apply_sort(sort, @invoice_sortable, @invoice_default_sort)
      |> preload([
        :customer,
        :customer_order,
        :created_by,
        :updated_by,
        :sent_by,
        :cancelled_by,
        :payments
      ])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp normalise_sort({:code, dir}), do: {:id, dir}
  defp normalise_sort(other), do: other

  defp maybe_status_filter(query, nil), do: query
  defp maybe_status_filter(query, ""), do: query
  defp maybe_status_filter(query, s) when is_binary(s),
    do: where(query, [i], i.status == ^s)

  defp maybe_customer_filter(query, nil), do: query
  defp maybe_customer_filter(query, ""), do: query

  defp maybe_customer_filter(query, id) when is_integer(id),
    do: where(query, [i], i.customer_id == ^id)

  defp maybe_customer_filter(query, id) when is_binary(id) do
    case Integer.parse(id) do
      {n, ""} -> where(query, [i], i.customer_id == ^n)
      _ -> query
    end
  end

  def get_for_company(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        CustomerInvoice
        |> where([i], i.company_id == ^company_id and i.uuid == ^cast)
        |> Repo.one()
        |> case do
          nil -> nil
          inv -> preload_invoice(inv)
        end

      :error ->
        nil
    end
  end

  def get_for_company(_company_id, _), do: nil

  # ----- create / update / delete ---------------------------------

  @doc """
  Create a draft invoice — header only. Use `create_from_co/3` to
  also pull lines from a confirmed CO at construct time.

  `invoice_date` defaults to today; `due_date` defaults to
  today + customer.payment_terms_days (or stays nil if the customer
  has no terms set).
  """
  def create(%User{} = actor, company_id, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "company_id" => company_id,
        "created_by_id" => actor.id,
        "updated_by_id" => actor.id
      })
      |> default_invoice_dates()

    %CustomerInvoice{}
    |> CustomerInvoice.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, inv} ->
        Audit.record_created(actor, "customer_invoice", inv, invoice_snapshot(inv))
        {:ok, preload_invoice(inv)}

      other ->
        other
    end
  end

  @doc """
  Create a draft invoice + copy unbilled qty from the given CO's
  lines. "Unbilled qty" = CO line qty_ordered − the sum of all qty
  already invoiced against that line on prior invoices for the same
  CO (drafts count too — we don't want two drafts double-counting
  the same shipment).

  Lines with unbilled qty <= 0 are skipped — they've already been
  fully invoiced.
  """
  def create_from_co(%User{} = actor, %CustomerOrder{} = co, attrs \\ %{}) do
    if co.status != "confirmed" do
      {:error, :co_not_confirmed}
    else
      co = preload_co(co)

      attrs =
        attrs
        |> stringify_keys()
        |> Map.merge(%{
          "company_id" => co.company_id,
          "customer_id" => co.customer_id,
          "customer_order_id" => co.id,
          "currency_code" => co.currency_code,
          # Header rates inherit from CO so the user doesn't have to
          # re-type tax / discount when they generate from a CO.
          "discount_pct" =>
            Map.get(attrs, "discount_pct") ||
              Map.get(attrs, :discount_pct) ||
              co.discount_pct,
          "tax_rate" =>
            Map.get(attrs, "tax_rate") ||
              Map.get(attrs, :tax_rate) ||
              co.tax_rate,
          "billing_address" =>
            Map.get(attrs, "billing_address") ||
              Map.get(attrs, :billing_address) ||
              co.delivery_address,
          "customer_reference" =>
            Map.get(attrs, "customer_reference") ||
              Map.get(attrs, :customer_reference) ||
              co.customer_reference
        })

      unbilled = unbilled_lines_for(co)

      if unbilled == [] do
        {:error, :nothing_to_invoice}
      else
        Repo.transaction(fn ->
          with {:ok, inv} <- create(actor, co.company_id, attrs),
               {:ok, _lines} <- copy_unbilled_lines(actor, inv, unbilled) do
            {:ok, recomputed} = recompute_totals(inv)
            preload_invoice(recomputed)
          else
            {:error, reason} -> Repo.rollback(reason)
          end
        end)
      end
    end
  end

  @doc """
  Create a credit-note invoice from an accepted RMA. Lines mirror
  the RMA's accepted-qty × snapshot unit_price as NEGATIVE amounts
  so the credit note's grand_total naturally subtracts from the
  customer's A/R when summed.

  The credit note is created as `status = "sent"` directly (no draft
  step) because it represents an action already taken — the RMA was
  accepted, the customer is owed the credit, and the audit log
  reflects that immediately.

  Lifts forward the source invoice's tax_rate so the credit note
  reverses the same tax that was originally charged.
  """
  def create_credit_note_from_rma(%User{} = actor, %CustomerReturn{} = rma) do
    rma = Repo.preload(rma, [:customer, :customer_invoice, lines: []])

    accepted_lines =
      Enum.filter(rma.lines, fn l ->
        l.qty_accepted &&
          Decimal.compare(l.qty_accepted, Decimal.new(0)) == :gt
      end)

    if accepted_lines == [] do
      {:error, :no_accepted_lines}
    else
      source = rma.customer_invoice

      attrs = %{
        "company_id" => rma.company_id,
        "customer_id" => rma.customer_id,
        "kind" => "credit_note",
        "currency_code" =>
          (source && source.currency_code) ||
            (rma.customer && rma.customer.currency_code) ||
            "GBP",
        # Mirror the source invoice's tax_rate so we reverse the
        # exact tax the customer was originally charged. If there's
        # no source (one-off RMA), default to 0.
        "tax_rate" => (source && source.tax_rate) || Decimal.new(0),
        "billing_address" =>
          (source && source.billing_address) ||
            (rma.customer && rma.customer.legal_address),
        "customer_reference" =>
          source && source.customer_reference,
        "free_text" =>
          "Credit note issued from RMA. See linked return for full inspection notes.",
        "created_by_id" => actor.id,
        "updated_by_id" => actor.id,
        "linked_rma_id" => rma.id,
        "linked_invoice_id" => source && source.id
      }
      |> default_invoice_dates()

      Repo.transaction(fn ->
        with {:ok, cn} <-
               %CustomerInvoice{}
               |> CustomerInvoice.changeset(attrs)
               |> Repo.insert(),
             {:ok, _lines} <- copy_credit_note_lines(actor, cn, accepted_lines),
             {:ok, totalled} <- recompute_totals(cn),
             {:ok, sent} <- flip_credit_note_to_sent(actor, totalled) do
          Audit.record_created(actor, "customer_invoice", sent, %{
            kind: sent.kind,
            customer_id: sent.customer_id,
            linked_rma_id: sent.linked_rma_id,
            grand_total: sent.grand_total
          })

          preload_invoice(sent)
        else
          {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
    end
  end

  defp copy_credit_note_lines(actor, %CustomerInvoice{} = cn, rma_lines) do
    Enum.reduce_while(rma_lines, {:ok, []}, fn rma_line, {:ok, acc} ->
      # Credit-note lines carry NEGATIVE qty so subtotals (and the
      # rolled-up grand_total) come out negative. unit_price stays
      # the snapshot we billed at originally.
      negative_qty = Decimal.minus(rma_line.qty_accepted)

      attrs =
        %{
          "customer_invoice_id" => cn.id,
          "company_id" => cn.company_id,
          "item_id" => rma_line.item_id,
          # Mirror the original source line if we have one — gives
          # the future audit a clean (CO line → invoice line → RMA
          # line → credit note line) chain.
          "customer_order_line_id" => nil,
          "qty" => negative_qty,
          "unit_price" => rma_line.unit_price,
          "description" => "Credit for RMA line"
        }
        |> stamp_line_subtotal()

      %CustomerInvoiceLine{}
      |> CustomerInvoiceLine.changeset(attrs)
      |> Repo.insert()
      |> case do
        {:ok, line} ->
          Audit.record_created(actor, "customer_invoice_line", line, %{
            customer_invoice_id: line.customer_invoice_id,
            item_id: line.item_id,
            qty: line.qty
          })

          {:cont, {:ok, [line | acc]}}

        {:error, cs} ->
          {:halt, {:error, cs}}
      end
    end)
  end

  defp flip_credit_note_to_sent(actor, %CustomerInvoice{} = cn) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    cn
    |> CustomerInvoice.transition_status_changeset(%{
      "status" => "sent",
      "sent_at" => now,
      "sent_by_id" => actor.id,
      "updated_by_id" => actor.id
    })
    |> Repo.update()
  end

  defp preload_co(%CustomerOrder{} = co) do
    Repo.preload(co, [:customer, lines: []])
  end

  defp unbilled_lines_for(%CustomerOrder{} = co) do
    line_ids = Enum.map(co.lines, & &1.id)

    # Sum already-invoiced qty per CO line across every non-cancelled
    # invoice for this CO. Drafts count so two drafts can't grab the
    # same qty (issue them one at a time).
    invoiced_by_line =
      from(il in CustomerInvoiceLine,
        join: i in CustomerInvoice,
        on: i.id == il.customer_invoice_id,
        where:
          il.customer_order_line_id in ^line_ids and
            i.status != "cancelled",
        group_by: il.customer_order_line_id,
        select: {il.customer_order_line_id, sum(il.qty)}
      )
      |> Repo.all()
      |> Map.new()

    co.lines
    |> Enum.map(fn line ->
      already = Map.get(invoiced_by_line, line.id, Decimal.new(0)) || Decimal.new(0)
      remaining = Decimal.sub(line.qty_ordered, already)
      {line, remaining}
    end)
    |> Enum.filter(fn {_line, remaining} ->
      Decimal.compare(remaining, Decimal.new(0)) == :gt
    end)
  end

  defp copy_unbilled_lines(actor, %CustomerInvoice{} = inv, unbilled) do
    Enum.reduce_while(unbilled, {:ok, []}, fn {%CustomerOrderLine{} = co_line, remaining_qty},
                                              {:ok, acc} ->
      attrs = %{
        "customer_invoice_id" => inv.id,
        "company_id" => inv.company_id,
        "item_id" => co_line.item_id,
        "customer_order_line_id" => co_line.id,
        "qty" => remaining_qty,
        "unit_price" => co_line.unit_price,
        "discount_pct" => co_line.discount_pct
      }
      |> stamp_line_subtotal()

      %CustomerInvoiceLine{}
      |> CustomerInvoiceLine.changeset(attrs)
      |> Repo.insert()
      |> case do
        {:ok, line} ->
          Audit.record_created(actor, "customer_invoice_line", line, %{
            customer_invoice_id: line.customer_invoice_id,
            item_id: line.item_id,
            qty: line.qty
          })

          {:cont, {:ok, [line | acc]}}

        {:error, cs} ->
          {:halt, {:error, cs}}
      end
    end)
  end

  defp default_invoice_dates(attrs) do
    today = Date.utc_today()

    attrs =
      case attrs["invoice_date"] do
        nil -> Map.put(attrs, "invoice_date", today)
        _ -> attrs
      end

    case attrs["due_date"] do
      nil ->
        # If we know the customer's terms, default due_date = today + N.
        case attrs["customer_id"] do
          nil -> attrs
          customer_id -> Map.put(attrs, "due_date", default_due_date_for(customer_id, attrs["invoice_date"]))
        end

      _ ->
        attrs
    end
  end

  defp default_due_date_for(customer_id, invoice_date) do
    case Repo.get(Customer, customer_id) do
      %Customer{payment_terms_days: days} when is_integer(days) ->
        base = parse_date_or_today(invoice_date)
        Date.add(base, days)

      _ ->
        nil
    end
  end

  defp parse_date_or_today(%Date{} = d), do: d

  defp parse_date_or_today(s) when is_binary(s) do
    case Date.from_iso8601(s) do
      {:ok, d} -> d
      _ -> Date.utc_today()
    end
  end

  defp parse_date_or_today(_), do: Date.utc_today()

  def update_header(%User{} = actor, %CustomerInvoice{status: "draft"} = inv, attrs) do
    before_state = invoice_snapshot(inv)
    str = attrs |> stringify_keys() |> Map.put("updated_by_id", actor.id)

    inv
    |> CustomerInvoice.changeset(str)
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(
          actor,
          "customer_invoice",
          updated,
          before_state,
          invoice_snapshot(updated)
        )

        {:ok, _} = recompute_totals(updated)
        {:ok, preload_invoice(updated)}

      other ->
        other
    end
  end

  def update_header(_actor, %CustomerInvoice{}, _), do: {:error, :bad_status}

  def delete(%User{} = actor, %CustomerInvoice{status: "draft"} = inv) do
    before_state = invoice_snapshot(inv)

    case Repo.delete(inv) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "customer_invoice", inv, before_state)
        {:ok, deleted}

      other ->
        other
    end
  end

  def delete(_actor, %CustomerInvoice{}), do: {:error, :bad_status}

  # ----- lines ----------------------------------------------------

  def add_line(%User{} = actor, %CustomerInvoice{status: "draft"} = inv, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "customer_invoice_id" => inv.id,
        "company_id" => inv.company_id
      })
      |> stamp_line_subtotal()

    %CustomerInvoiceLine{}
    |> CustomerInvoiceLine.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, line} ->
        Audit.record_created(actor, "customer_invoice_line", line, %{
          customer_invoice_id: line.customer_invoice_id,
          item_id: line.item_id,
          qty: line.qty
        })

        {:ok, _} = recompute_totals(inv)
        {:ok, Repo.preload(line, [item: :stock_uom])}

      other ->
        other
    end
  end

  def add_line(_, %CustomerInvoice{}, _), do: {:error, :bad_status}

  def update_line(%User{} = actor, %CustomerInvoiceLine{} = line, attrs) do
    inv = Repo.get!(CustomerInvoice, line.customer_invoice_id)

    if inv.status != "draft" do
      {:error, :bad_status}
    else
      before = %{qty: line.qty, unit_price: line.unit_price, discount_pct: line.discount_pct}
      attrs = attrs |> stringify_keys() |> stamp_line_subtotal()

      line
      |> CustomerInvoiceLine.changeset(attrs)
      |> Repo.update()
      |> case do
        {:ok, updated} ->
          Audit.record_updated(
            actor,
            "customer_invoice_line",
            updated,
            before,
            %{qty: updated.qty, unit_price: updated.unit_price, discount_pct: updated.discount_pct}
          )

          {:ok, _} = recompute_totals(inv)
          {:ok, Repo.preload(updated, [item: :stock_uom])}

        other ->
          other
      end
    end
  end

  def delete_line(%User{} = actor, %CustomerInvoiceLine{} = line) do
    inv = Repo.get!(CustomerInvoice, line.customer_invoice_id)

    if inv.status != "draft" do
      {:error, :bad_status}
    else
      case Repo.delete(line) do
        {:ok, deleted} ->
          Audit.record_deleted(actor, "customer_invoice_line", line, %{
            customer_invoice_id: line.customer_invoice_id,
            item_id: line.item_id
          })

          {:ok, _} = recompute_totals(inv)
          {:ok, deleted}

        other ->
          other
      end
    end
  end

  def get_line(invoice_id, uuid) when is_integer(invoice_id) and is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from(l in CustomerInvoiceLine,
            where: l.customer_invoice_id == ^invoice_id and l.uuid == ^cast,
            preload: [item: :stock_uom, customer_order_line: []]
          )
        )

      :error ->
        nil
    end
  end

  def get_line(_, _), do: nil

  defp stamp_line_subtotal(attrs) do
    qty = to_dec(attrs["qty"])
    price = to_dec(attrs["unit_price"])
    disc = to_dec(attrs["discount_pct"] || 0)

    factor = Decimal.div(Decimal.sub(Decimal.new(100), disc), Decimal.new(100))

    sub =
      qty
      |> Decimal.mult(price)
      |> Decimal.mult(factor)
      |> Decimal.round(4)

    Map.put(attrs, "line_subtotal", sub)
  end

  defp to_dec(nil), do: Decimal.new(0)
  defp to_dec(%Decimal{} = d), do: d
  defp to_dec(n) when is_integer(n), do: Decimal.new(n)
  defp to_dec(n) when is_float(n), do: Decimal.from_float(n)

  defp to_dec(s) when is_binary(s) do
    case Decimal.parse(s) do
      {d, _} -> d
      :error -> Decimal.new(0)
    end
  end

  defp to_dec(_), do: Decimal.new(0)

  def recompute_totals(%CustomerInvoice{} = inv) do
    inv = Repo.get!(CustomerInvoice, inv.id)

    lines =
      Repo.all(
        from l in CustomerInvoiceLine,
          where: l.customer_invoice_id == ^inv.id
      )

    subtotal =
      Enum.reduce(lines, Decimal.new(0), fn line, acc ->
        Decimal.add(acc, line.line_subtotal || Decimal.new(0))
      end)
      |> Decimal.round(2)

    discount_pct = inv.discount_pct || Decimal.new(0)
    tax_rate = inv.tax_rate || Decimal.new(0)

    discount_amount =
      subtotal
      |> Decimal.mult(discount_pct)
      |> Decimal.div(100)
      |> Decimal.round(2)

    taxable = Decimal.sub(subtotal, discount_amount)

    tax_amount =
      taxable
      |> Decimal.mult(tax_rate)
      |> Decimal.div(100)
      |> Decimal.round(2)

    grand_total =
      subtotal
      |> Decimal.sub(discount_amount)
      |> Decimal.add(tax_amount)
      |> Decimal.round(2)

    inv
    |> CustomerInvoice.totals_changeset(%{
      "subtotal" => subtotal,
      "discount_amount" => discount_amount,
      "tax_amount" => tax_amount,
      "grand_total" => grand_total
    })
    |> Repo.update()
  end

  # ----- state machine + gates ------------------------------------

  def mark_sent(%User{} = actor, %CustomerInvoice{} = inv) do
    if inv.status != "draft" do
      {:error, :bad_status}
    else
      inv = preload_invoice(inv)

      with :ok <- ensure_lines_present(inv),
           :ok <- ensure_customer_approved(inv),
           :ok <- ensure_positive_total(inv) do
        now = DateTime.utc_now() |> DateTime.truncate(:second)

        transition(actor, inv, %{
          "status" => "sent",
          "sent_at" => now,
          "sent_by_id" => actor.id,
          "updated_by_id" => actor.id
        })
      end
    end
  end

  def cancel(%User{} = actor, %CustomerInvoice{} = inv, reason) when is_binary(reason) do
    inv = preload_invoice(inv)

    cond do
      inv.status in ~w(paid cancelled) ->
        {:error, :bad_status}

      Enum.any?(inv.payments, &payment_positive?/1) ->
        # Any positive payment means we've already taken money — can't
        # silently void the invoice. The operator must record a
        # negative payment (refund) first.
        {:error, :payments_recorded}

      true ->
        now = DateTime.utc_now() |> DateTime.truncate(:second)

        transition(actor, inv, %{
          "status" => "cancelled",
          "cancelled_at" => now,
          "cancelled_by_id" => actor.id,
          "cancellation_reason" => reason,
          "updated_by_id" => actor.id
        })
    end
  end

  defp payment_positive?(%CustomerInvoicePayment{amount: %Decimal{} = a}),
    do: Decimal.compare(a, Decimal.new(0)) == :gt

  defp payment_positive?(_), do: false

  defp transition(actor, %CustomerInvoice{} = inv, attrs) do
    before_state = invoice_snapshot(inv)

    inv
    |> CustomerInvoice.transition_status_changeset(attrs)
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(
          actor,
          "customer_invoice",
          updated,
          before_state,
          invoice_snapshot(updated)
        )

        {:ok, preload_invoice(updated)}

      other ->
        other
    end
  end

  defp ensure_lines_present(%CustomerInvoice{lines: lines})
       when is_list(lines) and lines != [],
       do: :ok

  defp ensure_lines_present(_), do: {:error, :no_lines}

  defp ensure_customer_approved(%CustomerInvoice{customer: customer})
       when not is_nil(customer) do
    if Customers.approval_active?(customer),
      do: :ok,
      else: {:error, :customer_not_approved}
  end

  defp ensure_customer_approved(_), do: {:error, :customer_not_approved}

  defp ensure_positive_total(%CustomerInvoice{grand_total: total}) do
    if Decimal.compare(total || Decimal.new(0), Decimal.new(0)) == :gt do
      :ok
    else
      {:error, :grand_total_must_be_positive}
    end
  end

  # ----- payments -------------------------------------------------

  @doc """
  Record a payment against an invoice. Auto-flips status:
    * outstanding > 0 ⇒ partially_paid
    * outstanding ≤ 0 ⇒ paid

  Allows negative amounts (refunds) — the same auto-flip runs in
  reverse: a refund that brings paid below the total flips paid back
  to partially_paid.
  """
  def record_payment(%User{} = actor, %CustomerInvoice{} = inv, attrs) do
    if inv.status in ~w(draft cancelled) do
      {:error, :bad_status}
    else
      attrs =
        attrs
        |> stringify_keys()
        |> Map.merge(%{
          "customer_invoice_id" => inv.id,
          "company_id" => inv.company_id,
          "recorded_by_id" => actor.id
        })

      Repo.transaction(fn ->
        with {:ok, payment} <-
               %CustomerInvoicePayment{}
               |> CustomerInvoicePayment.changeset(attrs)
               |> Repo.insert(),
             {:ok, refreshed} <- maybe_flip_status_after_payment(actor, inv) do
          Audit.record_created(actor, "customer_invoice_payment", payment, %{
            customer_invoice_id: payment.customer_invoice_id,
            amount: payment.amount,
            method: payment.method,
            paid_at: payment.paid_at
          })

          %{payment: Repo.preload(payment, [:recorded_by]), invoice: refreshed}
        else
          {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
    end
  end

  defp maybe_flip_status_after_payment(actor, %CustomerInvoice{} = inv) do
    refreshed = preload_invoice(inv)
    outstanding = outstanding_for_invoice(refreshed)

    target =
      cond do
        Decimal.compare(outstanding, Decimal.new(0)) != :gt -> "paid"
        Enum.any?(refreshed.payments, &payment_positive?/1) -> "partially_paid"
        true -> refreshed.status
      end

    if target != refreshed.status do
      case transition(actor, refreshed, %{
             "status" => target,
             "updated_by_id" => actor.id
           }) do
        {:ok, post_transition} = ok ->
          # Edge into `paid` is the trigger for loyalty rebate accrual.
          # The hook is idempotent at the DB level (unique index on
          # customer_credits accruals) so a re-firing can't double-grant.
          if target == "paid" do
            Backend.Loyalty.accrue_on_invoice_paid(post_transition, actor)
          end

          ok

        other ->
          other
      end
    else
      {:ok, refreshed}
    end
  end

  @doc """
  Outstanding balance on a single invoice. Cancelled = 0.
  """
  def outstanding_for_invoice(%CustomerInvoice{status: "cancelled"}), do: Decimal.new(0)

  def outstanding_for_invoice(%CustomerInvoice{} = inv) do
    inv = preload_invoice(inv)
    total_paid = Enum.reduce(inv.payments, Decimal.new(0), fn p, acc ->
      Decimal.add(acc, p.amount || Decimal.new(0))
    end)

    Decimal.sub(inv.grand_total || Decimal.new(0), total_paid)
  end

  # ----- A/R outstanding (used by CO credit-limit gate) -----------

  @doc """
  Customer's total outstanding A/R:

      sum of (invoice.grand_total − sum(payments.amount))
        for invoices in [sent, partially_paid]
      +
      sum of (CO.grand_total) for confirmed COs
        MINUS the portion already pulled onto a non-cancelled invoice

  This is the regulator's definition of trade exposure: what the
  customer owes, plus what they're about to owe but haven't been
  invoiced for yet. Used by `CustomerOrders.ensure_credit_limit_ok/1`.
  """
  def outstanding_ar_for(customer_id, opts \\ []) when is_integer(customer_id) do
    exclude_co_id = Keyword.get(opts, :exclude_co_id)

    unpaid_invoice_total =
      from(i in CustomerInvoice,
        left_join: p in CustomerInvoicePayment,
        on: p.customer_invoice_id == i.id,
        where:
          i.customer_id == ^customer_id and
            i.status in ["sent", "partially_paid"],
        group_by: i.id,
        select: fragment("? - COALESCE(SUM(?), 0)", i.grand_total, p.amount)
      )
      |> Repo.all()
      |> Enum.reduce(Decimal.new(0), fn val, acc ->
        Decimal.add(acc, val || Decimal.new(0))
      end)

    confirmed_co_total =
      confirmed_co_total_unbilled(customer_id, exclude_co_id)

    Decimal.add(unpaid_invoice_total, confirmed_co_total)
  end

  # For each confirmed (non-cancelled) CO, compute what hasn't yet
  # been pulled onto a non-cancelled invoice — that's the "about to
  # be billed" portion of A/R.
  defp confirmed_co_total_unbilled(customer_id, exclude_co_id) do
    co_query =
      from(co in CustomerOrder,
        where: co.customer_id == ^customer_id and co.status == "confirmed",
        select: {co.id, co.grand_total}
      )

    co_query =
      if is_integer(exclude_co_id) do
        where(co_query, [co], co.id != ^exclude_co_id)
      else
        co_query
      end

    cos = Repo.all(co_query)

    if cos == [] do
      Decimal.new(0)
    else
      co_ids = Enum.map(cos, fn {id, _} -> id end)

      already_invoiced =
        from(il in CustomerInvoiceLine,
          join: i in CustomerInvoice,
          on: i.id == il.customer_invoice_id,
          join: col in CustomerOrderLine,
          on: col.id == il.customer_order_line_id,
          where:
            col.customer_order_id in ^co_ids and
              i.status != "cancelled",
          group_by: col.customer_order_id,
          select: {col.customer_order_id, sum(il.line_subtotal)}
        )
        |> Repo.all()
        |> Map.new()

      Enum.reduce(cos, Decimal.new(0), fn {co_id, grand_total}, acc ->
        billed = Map.get(already_invoiced, co_id, Decimal.new(0)) || Decimal.new(0)
        remaining = Decimal.sub(grand_total || Decimal.new(0), billed)
        if Decimal.compare(remaining, Decimal.new(0)) == :gt,
          do: Decimal.add(acc, remaining),
          else: acc
      end)
    end
  end

  # ----- internals -------------------------------------------------

  defp preload_invoice(%CustomerInvoice{} = inv) do
    Repo.preload(inv, [
      :customer,
      :customer_order,
      :created_by,
      :updated_by,
      :sent_by,
      :cancelled_by,
      [lines: [item: :stock_uom, customer_order_line: []]],
      [payments: [:recorded_by]]
    ])
  end

  defp invoice_snapshot(%CustomerInvoice{} = i),
    do: Map.new(@invoice_audit_fields, fn k -> {k, Map.get(i, k)} end)

  defp stringify_keys(attrs) when is_map(attrs) do
    Map.new(attrs, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end

  @doc """
  Helper for the FE: due-date suggestion when the salesperson is
  creating a manual invoice (no CO source) — `today + customer.payment_terms_days`.
  """
  def default_due_date(customer_id) when is_integer(customer_id) do
    default_due_date_for(customer_id, Date.utc_today())
  end

  def default_due_date(_), do: nil

end
