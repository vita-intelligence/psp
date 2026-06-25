defmodule Backend.Statistics do
  @moduledoc """
  Sales-side analytics — the look-back companion to the look-forward
  cash-flow forecast. Powers /sales/statistics.

  Five panels, all derived live (no materialised views, no warmers):

    * **KPIs** — revenue this month + YTD + vs prior year, average
      invoice value, invoices sent count, active-customer count.
    * **Monthly revenue series** — last 12 months, separating
      regular invoice revenue from credit notes (so the salesperson
      can see returns eating into the line).
    * **Top customers** — last 12 months, ranked by revenue, with a
      mini-monthly sparkline.
    * **Top items** — last 12 months, ranked by line-revenue + qty
      shipped.
    * **Lifecycle funnel** — count of customers in lead / prospect /
      active / dormant / inactive, computed via
      `Customers.status_projection/1`.

  All money is converted to the company base currency; foreign rows
  whose FX rate is missing land in `excluded_currencies` so the FE
  flags the gap.

  Revenue convention: `customer_invoices.grand_total` MINUS payments
  is "outstanding" (covered by CashFlow). For statistics we count
  revenue as `grand_total` on **sent / partially_paid / paid**
  invoices (regardless of pay status — booking it on issue, not on
  receipt of cash). Cancelled invoices are excluded. Credit notes
  carry negative grand_total so summing all kinds naturally reduces
  revenue for the period.
  """

  import Ecto.Query, warn: false

  alias Backend.Companies.Company
  alias Backend.Customers.Customer
  alias Backend.CustomerInvoices.{CustomerInvoice, CustomerInvoiceLine}
  alias Backend.Repo

  @months_back 12
  @top_rows 10

  @doc """
  Build the analytics snapshot for the company. Cheap enough to run
  on every page load at our scale — no caching yet.
  """
  def snapshot(%Company{} = company, opts \\ []) do
    months = Keyword.get(opts, :months, @months_back)

    today = Date.utc_today()
    series_starts = month_starts(today, months)

    {revenue_by_month, ex1} = revenue_by_month(company, series_starts)
    {kpis, ex2} = kpis(company, today)
    {top_customers, ex3} = top_customers(company, series_starts)
    {top_items, ex4} = top_items(company, series_starts)
    funnel = lifecycle_funnel(company)

    excluded = Enum.uniq(ex1 ++ ex2 ++ ex3 ++ ex4)

    %{
      months: months,
      base_currency: company.currency_code,
      excluded_currencies: excluded,
      kpis: kpis,
      revenue_by_month: revenue_by_month,
      top_customers: top_customers,
      top_items: top_items,
      funnel: funnel
    }
  end

  # ----- KPIs -----------------------------------------------------

  defp kpis(%Company{} = company, today) do
    month_start = Date.new!(today.year, today.month, 1)
    year_start = Date.new!(today.year, 1, 1)
    prior_year_start = Date.new!(today.year - 1, 1, 1)
    prior_year_end = Date.new!(today.year - 1, 12, 31)

    {invoice_rows, excluded} = invoice_rows(company)

    rev_this_month =
      invoice_rows
      |> Enum.filter(&date_in?(&1.date, month_start, today))
      |> sum_amounts()

    rev_ytd =
      invoice_rows
      |> Enum.filter(&date_in?(&1.date, year_start, today))
      |> sum_amounts()

    rev_prior_ytd =
      invoice_rows
      |> Enum.filter(fn r ->
        date_in?(r.date, prior_year_start, Date.add(prior_year_start, day_of_year(today) - 1))
      end)
      |> sum_amounts()

    rev_prior_year_full =
      invoice_rows
      |> Enum.filter(&date_in?(&1.date, prior_year_start, prior_year_end))
      |> sum_amounts()

    invoices_sent_count =
      invoice_rows
      |> Enum.filter(&(&1.kind == "invoice"))
      |> length()

    avg_invoice_value =
      if invoices_sent_count > 0 do
        Decimal.div(
          invoice_rows
          |> Enum.filter(&(&1.kind == "invoice"))
          |> sum_amounts(),
          Decimal.new(invoices_sent_count)
        )
        |> Decimal.round(2)
      else
        Decimal.new(0)
      end

    active_customers =
      invoice_rows
      |> Enum.filter(&(&1.date && date_in?(&1.date, year_start, today)))
      |> Enum.map(& &1.customer_id)
      |> Enum.uniq()
      |> length()

    {%{
       revenue_this_month: rev_this_month,
       revenue_ytd: rev_ytd,
       revenue_prior_ytd: rev_prior_ytd,
       revenue_prior_year_full: rev_prior_year_full,
       invoices_sent_count: invoices_sent_count,
       avg_invoice_value: avg_invoice_value,
       active_customers: active_customers
     }, excluded}
  end

  # ----- monthly revenue series ----------------------------------

  defp revenue_by_month(%Company{} = company, series_starts) do
    {invoice_rows, excluded} = invoice_rows(company)

    series =
      Enum.map(series_starts, fn m_start ->
        m_end = end_of_month(m_start)

        in_month = Enum.filter(invoice_rows, &date_in?(&1.date, m_start, m_end))

        invoice_revenue =
          in_month
          |> Enum.filter(&(&1.kind == "invoice"))
          |> sum_amounts()

        credit_notes =
          in_month
          |> Enum.filter(&(&1.kind == "credit_note"))
          |> sum_amounts()
          |> Decimal.abs()

        net = Decimal.sub(invoice_revenue, credit_notes)

        %{
          month_start: m_start,
          invoice_revenue: invoice_revenue,
          credit_notes: credit_notes,
          net: net
        }
      end)

    {series, excluded}
  end

  # ----- top customers --------------------------------------------

  defp top_customers(%Company{} = company, series_starts) do
    {invoice_rows, excluded} = invoice_rows(company)

    period_start = List.first(series_starts)
    period_end = List.last(series_starts) |> end_of_month()

    in_window =
      Enum.filter(invoice_rows, fn r ->
        date_in?(r.date, period_start, period_end)
      end)

    by_customer =
      Enum.group_by(in_window, & &1.customer_id)

    ids = Map.keys(by_customer) |> Enum.reject(&is_nil/1)

    name_lookup =
      from(c in Customer, where: c.id in ^ids, select: {c.id, c.name})
      |> Repo.all()
      |> Enum.into(%{})

    rows =
      by_customer
      |> Enum.map(fn {cid, rows} ->
        revenue = sum_amounts(rows)

        monthly_series =
          Enum.map(series_starts, fn m_start ->
            m_end = end_of_month(m_start)

            rows
            |> Enum.filter(&date_in?(&1.date, m_start, m_end))
            |> sum_amounts()
          end)

        %{
          customer_id: cid,
          customer_name: Map.get(name_lookup, cid, "—"),
          revenue: revenue,
          monthly_series: monthly_series
        }
      end)
      |> Enum.reject(&is_nil(&1.customer_id))
      |> Enum.sort_by(& &1.revenue, fn a, b -> Decimal.compare(a, b) == :gt end)
      |> Enum.take(@top_rows)

    {rows, excluded}
  end

  # ----- top items -----------------------------------------------

  defp top_items(%Company{id: cid, currency_code: base} = company, series_starts) do
    period_start = List.first(series_starts)
    period_end = List.last(series_starts) |> end_of_month()

    # Pull each invoice line + its parent invoice's date / status /
    # currency. Aggregating in SQL would require currency conversion
    # inline; for V1 we pull rows and aggregate in Elixir using the
    # same FX helper as cash-flow.
    query =
      from(l in CustomerInvoiceLine,
        join: i in CustomerInvoice,
        on: i.id == l.customer_invoice_id,
        where: i.company_id == ^cid,
        where: i.status in ["sent", "partially_paid", "paid"],
        where: i.invoice_date >= ^period_start and i.invoice_date <= ^period_end,
        where: not is_nil(l.item_id),
        select: %{
          item_id: l.item_id,
          qty: l.qty,
          line_subtotal: l.line_subtotal,
          currency_code: i.currency_code
        }
      )

    rows = Repo.all(query)
    rates = company.currency_rates || %{}

    {rows_in_base, excluded} =
      Enum.reduce(rows, {[], []}, fn r, {acc, excl} ->
        case convert_to_base(r.line_subtotal, r.currency_code, base, rates) do
          {:ok, amount} -> {[Map.put(r, :amount, amount) | acc], excl}
          {:error, :no_rate} -> {acc, [r.currency_code | excl]}
        end
      end)

    by_item = Enum.group_by(rows_in_base, & &1.item_id)
    item_ids = Map.keys(by_item)

    item_lookup =
      from(i in Backend.Items.Item,
        where: i.id in ^item_ids,
        select: {i.id, %{id: i.id, uuid: i.uuid, name: i.name}}
      )
      |> Repo.all()
      |> Enum.into(%{})

    top =
      by_item
      |> Enum.map(fn {iid, rs} ->
        revenue = Enum.reduce(rs, Decimal.new(0), &Decimal.add(&2, &1.amount))
        qty_total = Enum.reduce(rs, Decimal.new(0), &Decimal.add(&2, ensure_decimal(&1.qty)))

        item = Map.get(item_lookup, iid, %{id: iid, uuid: nil, name: "—"})

        %{
          item_id: iid,
          item_uuid: item.uuid,
          item_name: item.name,
          revenue: revenue,
          qty: qty_total
        }
      end)
      |> Enum.sort_by(& &1.revenue, fn a, b -> Decimal.compare(a, b) == :gt end)
      |> Enum.take(@top_rows)

    {top, excluded}
  end

  # ----- lifecycle funnel ----------------------------------------

  defp lifecycle_funnel(%Company{id: cid}) do
    customers = Repo.all(from(c in Customer, where: c.company_id == ^cid))

    Enum.reduce(customers, %{lead: 0, prospect: 0, active: 0, dormant: 0, inactive: 0}, fn c,
                                                                                          acc ->
      status = Backend.Customers.status_projection(c)
      Map.update(acc, status, 1, &(&1 + 1))
    end)
  end

  # ----- shared invoice loader -----------------------------------

  # Flattens every revenue-bearing invoice into a row keyed by date,
  # converted to base currency. Reused by KPIs + monthly series + top
  # customers so the company FX rates are applied once per row.
  defp invoice_rows(%Company{id: cid, currency_code: base} = company) do
    cutoff = Date.add(Date.utc_today(), -730)

    query =
      from(i in CustomerInvoice,
        where: i.company_id == ^cid,
        where: i.status in ["sent", "partially_paid", "paid"],
        where: i.invoice_date >= ^cutoff,
        select: %{
          id: i.id,
          customer_id: i.customer_id,
          kind: i.kind,
          grand_total: i.grand_total,
          currency_code: i.currency_code,
          date: i.invoice_date
        }
      )

    rates = company.currency_rates || %{}

    Repo.all(query)
    |> Enum.reduce({[], []}, fn r, {acc, excl} ->
      case convert_to_base(r.grand_total, r.currency_code, base, rates) do
        {:ok, amount} ->
          {[Map.put(r, :amount, amount) | acc], excl}

        {:error, :no_rate} ->
          {acc, [r.currency_code | excl]}
      end
    end)
  end

  defp sum_amounts(rows), do: Enum.reduce(rows, Decimal.new(0), &Decimal.add(&2, &1.amount))

  defp convert_to_base(amount, ccy, base, _rates) when ccy == base, do: {:ok, amount}

  defp convert_to_base(amount, ccy, _base, rates) do
    case Map.get(rates, ccy) do
      nil ->
        {:error, :no_rate}

      rate when is_binary(rate) ->
        convert_to_base(amount, ccy, nil, %{ccy => Decimal.new(rate)})

      rate ->
        case Decimal.compare(rate, Decimal.new(0)) do
          :gt -> {:ok, Decimal.div(amount, rate)}
          _ -> {:error, :no_rate}
        end
    end
  end

  # ----- date helpers --------------------------------------------

  defp month_starts(%Date{} = today, months) do
    base = Date.new!(today.year, today.month, 1)

    (months - 1)..0
    |> Enum.map(fn offset -> add_months(base, -offset) end)
  end

  defp end_of_month(%Date{} = d) do
    next = add_months(d, 1)
    Date.add(next, -1)
  end

  defp add_months(%Date{year: y, month: m}, offset) do
    total = (y * 12 + (m - 1)) + offset
    new_y = div(total, 12)
    new_m = rem(total, 12) + 1
    Date.new!(new_y, new_m, 1)
  end

  defp date_in?(nil, _, _), do: false

  defp date_in?(%Date{} = d, %Date{} = from, %Date{} = to) do
    Date.compare(d, from) != :lt and Date.compare(d, to) != :gt
  end

  defp day_of_year(%Date{} = d) do
    Date.diff(d, Date.new!(d.year, 1, 1)) + 1
  end

  defp ensure_decimal(%Decimal{} = d), do: d
  defp ensure_decimal(n) when is_integer(n), do: Decimal.new(n)
  defp ensure_decimal(n) when is_float(n), do: Decimal.from_float(n)
  defp ensure_decimal(n) when is_binary(n), do: Decimal.new(n)
  defp ensure_decimal(_), do: Decimal.new(0)
end
