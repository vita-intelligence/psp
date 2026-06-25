defmodule Backend.SalesManagement do
  @moduledoc """
  Sales management surface — pipeline + book-of-business view, keyed
  by `customers.account_manager_id`. Powers /sales/sales-management.

  Three panels:

    * **Leaderboard** — one row per account manager, summarising:
      revenue YTD, outstanding A/R, # customers in their book,
      pipeline value (sum of grand_totals on confirmed COs not yet
      fully invoiced).
    * **Pipeline funnel** — value-weighted CO funnel by status,
      from `draft` through `confirmed`, ignoring `cancelled`. Lets
      management see where deals stall.
    * **Unassigned customers** — accounts whose `account_manager_id`
      is null. Management routes these onto someone's plate.

  Money rolls up in the company base currency using
  `companies.currency_rates`; foreign-currency rows without a rate
  contribute their currency code to `excluded_currencies` so the FE
  flags the gap.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.CustomerInvoices.{CustomerInvoice, CustomerInvoicePayment}
  alias Backend.CustomerOrders.CustomerOrder
  alias Backend.Customers.Customer
  alias Backend.Repo

  @doc """
  Build the snapshot for the company. Cheap at our scale; no cache.
  """
  def snapshot(%Company{} = company) do
    today = Date.utc_today()
    year_start = Date.new!(today.year, 1, 1)

    {invoice_rows, ar_excluded} = invoice_rows(company)
    {co_rows, co_excluded} = co_rows(company)
    customer_rows = customer_rows(company)
    manager_lookup = manager_lookup(company)

    leaderboard =
      build_leaderboard(
        customer_rows,
        invoice_rows,
        co_rows,
        manager_lookup,
        year_start,
        today
      )

    funnel = build_funnel(co_rows)
    unassigned = build_unassigned(customer_rows)

    %{
      base_currency: company.currency_code,
      excluded_currencies: Enum.uniq(ar_excluded ++ co_excluded),
      leaderboard: leaderboard,
      funnel: funnel,
      unassigned: unassigned
    }
  end

  # ----- source loaders -------------------------------------------

  defp customer_rows(%Company{id: cid}) do
    from(c in Customer,
      where: c.company_id == ^cid,
      select: %{
        id: c.id,
        uuid: c.uuid,
        name: c.name,
        account_manager_id: c.account_manager_id,
        approval_status: c.approval_status,
        is_active: c.is_active,
        last_contact_at: c.last_contact_at,
        total_orders_count: c.total_orders_count
      }
    )
    |> Repo.all()
  end

  defp manager_lookup(%Company{id: cid}) do
    # Pull every user who could be an account manager — anyone in the
    # company. Leaderboard surfaces only managers with at least one
    # assigned customer (or matching activity), but we want names for
    # all of them.
    from(u in User, where: u.company_id == ^cid, select: {u.id, u.name})
    |> Repo.all()
    |> Enum.into(%{})
  end

  defp invoice_rows(%Company{id: cid, currency_code: base} = company) do
    # We need: revenue (grand_total for sent/partially_paid/paid) +
    # outstanding A/R per customer. Outstanding A/R queries the full
    # history since old unpaid debt is still owed; the YTD revenue
    # cut is applied later in the leaderboard builder so we don't
    # have to re-query.
    query =
      from(i in CustomerInvoice,
        left_join: p in CustomerInvoicePayment,
        on: p.customer_invoice_id == i.id,
        where: i.company_id == ^cid,
        where: i.status in ["sent", "partially_paid", "paid"],
        group_by: [
          i.id,
          i.kind,
          i.customer_id,
          i.currency_code,
          i.grand_total,
          i.invoice_date,
          i.status
        ],
        select: %{
          id: i.id,
          kind: i.kind,
          customer_id: i.customer_id,
          currency_code: i.currency_code,
          grand_total: i.grand_total,
          paid: coalesce(sum(p.amount), 0),
          invoice_date: i.invoice_date,
          status: i.status
        }
      )

    rates = company.currency_rates || %{}

    Repo.all(query)
    |> Enum.reduce({[], []}, fn r, {acc, excl} ->
      case convert_to_base(r.grand_total, r.currency_code, base, rates) do
        {:ok, gt} ->
          {:ok, paid_in_base} =
            convert_to_base(ensure_decimal(r.paid), r.currency_code, base, rates)

          {[Map.merge(r, %{grand_total_base: gt, paid_base: paid_in_base}) | acc], excl}

        {:error, :no_rate} ->
          {acc, [r.currency_code | excl]}
      end
    end)
  end

  defp co_rows(%Company{id: cid, currency_code: base} = company) do
    # Each CO + the sum of any non-cancelled invoices linked to it.
    # Pipeline contribution = grand_total - already invoiced (only for
    # confirmed COs). Funnel contribution = grand_total (any status
    # except cancelled).
    query =
      from(co in CustomerOrder,
        left_join: ci in CustomerInvoice,
        on:
          ci.customer_order_id == co.id and
            ci.kind == "invoice" and
            ci.status != "cancelled",
        where: co.company_id == ^cid,
        where: co.status != "cancelled",
        group_by: [
          co.id,
          co.customer_id,
          co.status,
          co.currency_code,
          co.grand_total
        ],
        select: %{
          id: co.id,
          customer_id: co.customer_id,
          status: co.status,
          currency_code: co.currency_code,
          grand_total: co.grand_total,
          invoiced_sum: coalesce(sum(ci.grand_total), 0)
        }
      )

    rates = company.currency_rates || %{}

    Repo.all(query)
    |> Enum.reduce({[], []}, fn r, {acc, excl} ->
      with {:ok, gt} <- convert_to_base(r.grand_total, r.currency_code, base, rates),
           {:ok, inv} <- convert_to_base(ensure_decimal(r.invoiced_sum), r.currency_code, base, rates) do
        residual = Decimal.sub(gt, inv)
        residual = if Decimal.compare(residual, Decimal.new(0)) == :gt, do: residual, else: Decimal.new(0)

        {[
           Map.merge(r, %{grand_total_base: gt, invoiced_base: inv, residual_base: residual})
           | acc
         ], excl}
      else
        {:error, :no_rate} -> {acc, [r.currency_code | excl]}
      end
    end)
  end

  # ----- panel builders -------------------------------------------

  defp build_leaderboard(customers, invoices, cos, manager_lookup, year_start, today) do
    customers_by_manager = Enum.group_by(customers, & &1.account_manager_id)

    invoices_by_customer = Enum.group_by(invoices, & &1.customer_id)
    cos_by_customer = Enum.group_by(cos, & &1.customer_id)

    customers_by_manager
    |> Enum.reject(fn {mgr_id, _} -> is_nil(mgr_id) end)
    |> Enum.map(fn {mgr_id, mgr_customers} ->
      mgr_customer_ids = Enum.map(mgr_customers, & &1.id)

      mgr_invoices =
        mgr_customer_ids
        |> Enum.flat_map(fn cid -> Map.get(invoices_by_customer, cid, []) end)

      mgr_cos =
        mgr_customer_ids
        |> Enum.flat_map(fn cid -> Map.get(cos_by_customer, cid, []) end)

      revenue_ytd =
        mgr_invoices
        |> Enum.filter(fn r ->
          date_in?(r.invoice_date, year_start, today)
        end)
        |> Enum.reduce(Decimal.new(0), &Decimal.add(&2, &1.grand_total_base))

      outstanding_ar =
        mgr_invoices
        |> Enum.filter(&(&1.status in ["sent", "partially_paid"]))
        |> Enum.reduce(Decimal.new(0), fn r, acc ->
          Decimal.add(acc, Decimal.sub(r.grand_total_base, r.paid_base))
        end)

      pipeline_value =
        mgr_cos
        |> Enum.filter(&(&1.status == "confirmed"))
        |> Enum.reduce(Decimal.new(0), &Decimal.add(&2, &1.residual_base))

      active_customers_count =
        mgr_customers
        |> Enum.filter(& &1.is_active)
        |> length()

      approved_customers_count =
        mgr_customers
        |> Enum.filter(&(&1.approval_status == "approved" and &1.is_active))
        |> length()

      %{
        manager_id: mgr_id,
        manager_name: Map.get(manager_lookup, mgr_id, "—"),
        customers_count: length(mgr_customers),
        active_customers_count: active_customers_count,
        approved_customers_count: approved_customers_count,
        revenue_ytd: revenue_ytd,
        outstanding_ar: outstanding_ar,
        pipeline_value: pipeline_value
      }
    end)
    |> Enum.sort_by(& &1.revenue_ytd, fn a, b -> Decimal.compare(a, b) == :gt end)
  end

  @co_funnel_stages ~w(draft pending_approver pending_director approved confirmed)

  defp build_funnel(cos) do
    by_status = Enum.group_by(cos, & &1.status)

    Enum.map(@co_funnel_stages, fn stage ->
      rows = Map.get(by_status, stage, [])

      total =
        rows
        |> Enum.reduce(Decimal.new(0), &Decimal.add(&2, &1.grand_total_base))

      %{
        stage: stage,
        count: length(rows),
        total_value: total
      }
    end)
  end

  defp build_unassigned(customers) do
    customers
    |> Enum.filter(&(is_nil(&1.account_manager_id) and &1.is_active))
    |> Enum.map(fn c ->
      %{
        id: c.id,
        uuid: c.uuid,
        name: c.name,
        approval_status: c.approval_status,
        last_contact_at: c.last_contact_at,
        total_orders_count: c.total_orders_count
      }
    end)
    |> Enum.sort_by(& &1.name)
  end

  # ----- helpers --------------------------------------------------

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

  defp date_in?(nil, _, _), do: false

  defp date_in?(%Date{} = d, %Date{} = from, %Date{} = to) do
    Date.compare(d, from) != :lt and Date.compare(d, to) != :gt
  end

  defp ensure_decimal(%Decimal{} = d), do: d
  defp ensure_decimal(n) when is_integer(n), do: Decimal.new(n)
  defp ensure_decimal(n) when is_float(n), do: Decimal.from_float(n)
  defp ensure_decimal(n) when is_binary(n), do: Decimal.new(n)
  defp ensure_decimal(_), do: Decimal.new(0)
end
