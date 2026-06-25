defmodule Backend.CashFlow do
  @moduledoc """
  12-week cash-flow forecast — the finance dashboard for
  /sales/cash-flow.

  Four lanes, all expressed in the company's base currency:

  Inflows:
    * `ar_due`       — outstanding A/R on sent + partially-paid
      `customer_invoices`. Each invoice contributes
      `(grand_total - paid_amount)` to the bucket keyed by its
      `due_date`. Credit notes (kind=credit_note, negative
      grand_total) naturally subtract.
    * `ar_projected` — projected A/R from confirmed `customer_orders`
      that haven't been invoiced yet (or are partially invoiced).
      Each contributes `(grand_total - billed_so_far)` keyed by
      `expected_ship_date`. Approximated as `grand_total` when no
      invoice exists yet; precise once invoicing starts.

  Outflows:
    * `ap_due`       — outstanding A/P on received + disputed
      `procurement_invoices`. `(total_inc_tax - paid_amount)` keyed
      by `due_date`.
    * `ap_planned`   — committed PO spend not yet invoiced. Sums
      `purchase_orders` in ordered + partially_received states keyed
      by `expected_delivery_date`. Approximated as full `grand_total`
      until the procurement invoice lands.

  Rows whose target date is in the past land in the **overdue**
  rollup (one number per lane). Rows whose target date is null AND
  whose state is open are also rolled into overdue with the label
  "no date" — better to surface than to silently drop.

  Multi-currency: any foreign amount is divided by the company's
  `currency_rates[code]` to get the base-currency value. Missing
  rates land in `excluded_currencies` so the FE can flag the gap
  rather than silently zeroing the contribution.
  """

  import Ecto.Query, warn: false

  alias Backend.Companies.Company
  alias Backend.CustomerInvoices.{CustomerInvoice, CustomerInvoicePayment}
  alias Backend.CustomerOrders.CustomerOrder
  alias Backend.Procurement.Invoice, as: ProcurementInvoice
  alias Backend.Purchasing.PurchaseOrder
  alias Backend.Repo

  @horizon_weeks 12

  @doc """
  Build the 12-week forecast for the given company. Returns

      %{
        weeks_ahead: 12,
        week_starts: [~D[...], ...],
        buckets: [%{week_index, week_start, ar_due, ar_projected,
                    ap_due, ap_planned, net, cumulative}, ...],
        overdue: %{ar_due, ar_projected, ap_due, ap_planned, net},
        totals: %{outstanding_ar, projected_ar, outstanding_ap,
                  planned_ap, net_position},
        excluded_currencies: ["XOF", ...]
      }

  All amounts are `Decimal` in the company's base currency.
  """
  def forecast(%Company{} = company, opts \\ []) do
    weeks = Keyword.get(opts, :weeks, @horizon_weeks)
    today = Date.utc_today()
    week0_start = monday_of(today)
    week_starts = Enum.map(0..(weeks - 1), &Date.add(week0_start, &1 * 7))
    horizon_end = Date.add(week0_start, weeks * 7 - 1)

    {ar_due_rows, ar_excluded} = ar_due_rows(company)
    {ar_proj_rows, ar_proj_excluded} = ar_projected_rows(company)
    {ap_due_rows, ap_excluded} = ap_due_rows(company)
    {ap_plan_rows, ap_plan_excluded} = ap_planned_rows(company)

    blank_buckets =
      Enum.map(0..(weeks - 1), fn idx ->
        %{
          week_index: idx,
          week_start: Enum.at(week_starts, idx),
          ar_due: Decimal.new(0),
          ar_projected: Decimal.new(0),
          ap_due: Decimal.new(0),
          ap_planned: Decimal.new(0)
        }
      end)

    blank_overdue = %{
      ar_due: Decimal.new(0),
      ar_projected: Decimal.new(0),
      ap_due: Decimal.new(0),
      ap_planned: Decimal.new(0)
    }

    {buckets, overdue} =
      {blank_buckets, blank_overdue}
      |> apply_rows(ar_due_rows, :ar_due, week_starts, horizon_end, today)
      |> apply_rows(ar_proj_rows, :ar_projected, week_starts, horizon_end, today)
      |> apply_rows(ap_due_rows, :ap_due, week_starts, horizon_end, today)
      |> apply_rows(ap_plan_rows, :ap_planned, week_starts, horizon_end, today)

    buckets =
      buckets
      |> Enum.map(fn b ->
        net =
          b.ar_due
          |> Decimal.add(b.ar_projected)
          |> Decimal.sub(b.ap_due)
          |> Decimal.sub(b.ap_planned)

        Map.put(b, :net, net)
      end)
      |> running_cumulative()

    overdue_net =
      overdue.ar_due
      |> Decimal.add(overdue.ar_projected)
      |> Decimal.sub(overdue.ap_due)
      |> Decimal.sub(overdue.ap_planned)

    overdue = Map.put(overdue, :net, overdue_net)

    totals = compute_totals(buckets, overdue)

    %{
      weeks_ahead: weeks,
      week_starts: week_starts,
      buckets: buckets,
      overdue: overdue,
      totals: totals,
      excluded_currencies:
        Enum.uniq(ar_excluded ++ ar_proj_excluded ++ ap_excluded ++ ap_plan_excluded)
    }
  end

  # ----- row builders --------------------------------------------

  # `{rows, excluded_currencies}` where each row is
  # `%{amount: Decimal, date: Date | nil}` in base currency.
  defp ar_due_rows(%Company{id: cid} = company) do
    # paid_amount is derived — sum customer_invoice_payments grouped
    # by invoice. Left-join + coalesce so unpaid invoices still surface.
    query =
      from(i in CustomerInvoice,
        left_join: p in CustomerInvoicePayment,
        on: p.customer_invoice_id == i.id,
        where: i.company_id == ^cid,
        where: i.status in ["sent", "partially_paid"],
        group_by: [i.id, i.grand_total, i.currency_code, i.due_date, i.invoice_date],
        select: %{
          grand_total: i.grand_total,
          paid_amount: coalesce(sum(p.amount), 0),
          currency_code: i.currency_code,
          due_date: i.due_date,
          invoice_date: i.invoice_date
        }
      )

    Repo.all(query)
    |> rows_to_amounts(company, fn r ->
      outstanding = Decimal.sub(r.grand_total, ensure_decimal(r.paid_amount))
      target_date = r.due_date || r.invoice_date
      {outstanding, target_date, r.currency_code}
    end)
  end

  defp ar_projected_rows(%Company{id: cid} = company) do
    # Confirmed COs that have not yet been fully billed. We don't
    # have a real "billed_so_far" projection on the CO yet — V1
    # approximates as `grand_total` if no linked invoices exist, and
    # subtracts the sum of any linked invoice grand_totals otherwise.
    #
    # The double-counting risk: an invoice IS already counted in
    # ar_due, so for projected we must NOT include the portion that's
    # been invoiced. We use a left-join + lateral aggregate to compute
    # the residual.
    query =
      from(co in CustomerOrder,
        left_join: ci in CustomerInvoice,
        on:
          ci.customer_order_id == co.id and
            ci.kind == "invoice" and
            ci.status != "cancelled",
        where: co.company_id == ^cid,
        where: co.status == "confirmed",
        group_by: [
          co.id,
          co.grand_total,
          co.currency_code,
          co.expected_ship_date,
          co.confirmed_at
        ],
        select: %{
          grand_total: co.grand_total,
          currency_code: co.currency_code,
          expected_ship_date: co.expected_ship_date,
          confirmed_at: co.confirmed_at,
          invoiced_sum: coalesce(sum(ci.grand_total), 0)
        }
      )

    Repo.all(query)
    |> rows_to_amounts(company, fn r ->
      invoiced = r.invoiced_sum |> ensure_decimal()
      residual = Decimal.sub(r.grand_total, invoiced)

      # If the CO is fully invoiced, nothing to project.
      if Decimal.compare(residual, Decimal.new(0)) == :gt do
        target_date = r.expected_ship_date || date_of(r.confirmed_at)
        {residual, target_date, r.currency_code}
      else
        {Decimal.new(0), nil, r.currency_code}
      end
    end)
  end

  defp ap_due_rows(%Company{id: cid} = company) do
    query =
      from(i in ProcurementInvoice,
        where: i.company_id == ^cid,
        where: i.status in ["received", "disputed"],
        select: %{
          total_inc_tax: i.total_inc_tax,
          paid_amount: i.paid_amount,
          currency_code: i.currency_code,
          due_date: i.due_date,
          invoice_date: i.invoice_date
        }
      )

    Repo.all(query)
    |> rows_to_amounts(company, fn r ->
      outstanding = Decimal.sub(r.total_inc_tax, r.paid_amount)
      target_date = r.due_date || r.invoice_date
      {outstanding, target_date, r.currency_code}
    end)
  end

  defp ap_planned_rows(%Company{id: cid} = company) do
    query =
      from(po in PurchaseOrder,
        left_join: pi in ProcurementInvoice,
        on:
          pi.purchase_order_id == po.id and
            pi.status != "void",
        where: po.company_id == ^cid,
        where: po.status in ["ordered", "partially_received", "approved"],
        group_by: [
          po.id,
          po.grand_total,
          po.currency_code,
          po.expected_delivery_date
        ],
        select: %{
          grand_total: po.grand_total,
          currency_code: po.currency_code,
          expected_delivery_date: po.expected_delivery_date,
          invoiced_sum: coalesce(sum(pi.total_inc_tax), 0)
        }
      )

    Repo.all(query)
    |> rows_to_amounts(company, fn r ->
      invoiced = r.invoiced_sum |> ensure_decimal()
      residual = Decimal.sub(r.grand_total, invoiced)

      if Decimal.compare(residual, Decimal.new(0)) == :gt do
        {residual, r.expected_delivery_date, r.currency_code}
      else
        {Decimal.new(0), nil, r.currency_code}
      end
    end)
  end

  # ----- application + math --------------------------------------

  defp rows_to_amounts(rows, %Company{} = company, builder) do
    base = company.currency_code
    rates = company.currency_rates || %{}

    Enum.reduce(rows, {[], []}, fn r, {acc, excluded} ->
      {amount, date, currency} = builder.(r)

      case Decimal.compare(amount, Decimal.new(0)) do
        :eq ->
          {acc, excluded}

        _ ->
          case convert_to_base(amount, currency, base, rates) do
            {:ok, in_base} -> {[%{amount: in_base, date: date} | acc], excluded}
            {:error, :no_rate} -> {acc, [currency | excluded]}
          end
      end
    end)
  end

  defp convert_to_base(amount, ccy, base, _rates) when ccy == base, do: {:ok, amount}

  defp convert_to_base(amount, ccy, _base, rates) do
    case Map.get(rates, ccy) do
      nil ->
        {:error, :no_rate}

      rate when is_binary(rate) ->
        convert_to_base(amount, ccy, nil, %{ccy => Decimal.new(rate)})

      rate ->
        # rate = "1 base = X foreign", so amount_in_base = amount / rate
        case Decimal.compare(rate, Decimal.new(0)) do
          :gt -> {:ok, Decimal.div(amount, rate)}
          _ -> {:error, :no_rate}
        end
    end
  end

  defp apply_rows({buckets, overdue}, rows, key, week_starts, horizon_end, today) do
    week0 = List.first(week_starts)

    Enum.reduce(rows, {buckets, overdue}, fn %{amount: amount, date: date},
                                             {buckets_acc, overdue_acc} ->
      cond do
        is_nil(date) or Date.compare(date, today) == :lt or
            Date.compare(date, week0) == :lt ->
          {buckets_acc, Map.update!(overdue_acc, key, &Decimal.add(&1, amount))}

        Date.compare(date, horizon_end) == :gt ->
          # Beyond horizon — for V1 we fold into the last bucket so
          # the dashboard total still reflects the commitment.
          last_idx = length(buckets_acc) - 1

          {update_bucket(buckets_acc, last_idx, key, amount), overdue_acc}

        true ->
          idx = week_index_for(date, week_starts)
          {update_bucket(buckets_acc, idx, key, amount), overdue_acc}
      end
    end)
  end

  defp update_bucket(buckets, idx, key, amount) do
    List.update_at(buckets, idx, fn b -> Map.update!(b, key, &Decimal.add(&1, amount)) end)
  end

  defp week_index_for(date, week_starts) do
    Enum.find_index(week_starts, fn ws ->
      Date.compare(date, ws) != :lt and
        Date.compare(date, Date.add(ws, 7)) == :lt
    end) || 0
  end

  defp running_cumulative(buckets) do
    {acc, _} =
      Enum.reduce(buckets, {[], Decimal.new(0)}, fn b, {out, running} ->
        new_running = Decimal.add(running, b.net)
        {[Map.put(b, :cumulative, new_running) | out], new_running}
      end)

    Enum.reverse(acc)
  end

  defp compute_totals(buckets, overdue) do
    outstanding_ar =
      overdue.ar_due
      |> Decimal.add(sum_field(buckets, :ar_due))

    projected_ar =
      overdue.ar_projected
      |> Decimal.add(sum_field(buckets, :ar_projected))

    outstanding_ap =
      overdue.ap_due
      |> Decimal.add(sum_field(buckets, :ap_due))

    planned_ap =
      overdue.ap_planned
      |> Decimal.add(sum_field(buckets, :ap_planned))

    net_position =
      outstanding_ar
      |> Decimal.add(projected_ar)
      |> Decimal.sub(outstanding_ap)
      |> Decimal.sub(planned_ap)

    %{
      outstanding_ar: outstanding_ar,
      projected_ar: projected_ar,
      outstanding_ap: outstanding_ap,
      planned_ap: planned_ap,
      net_position: net_position
    }
  end

  defp sum_field(buckets, key) do
    Enum.reduce(buckets, Decimal.new(0), fn b, acc -> Decimal.add(acc, Map.get(b, key)) end)
  end

  # ----- helpers --------------------------------------------------

  defp monday_of(%Date{} = d) do
    case Date.day_of_week(d) do
      1 -> d
      n -> Date.add(d, -(n - 1))
    end
  end

  defp date_of(%DateTime{} = dt), do: DateTime.to_date(dt)
  defp date_of(_), do: nil

  defp ensure_decimal(%Decimal{} = d), do: d
  defp ensure_decimal(n) when is_integer(n), do: Decimal.new(n)
  defp ensure_decimal(n) when is_float(n), do: Decimal.from_float(n)
  defp ensure_decimal(n) when is_binary(n), do: Decimal.new(n)
  defp ensure_decimal(_), do: Decimal.new(0)
end
