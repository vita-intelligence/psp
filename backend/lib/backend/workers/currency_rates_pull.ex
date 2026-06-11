defmodule Backend.Workers.CurrencyRatesPull do
  @moduledoc """
  Daily ECB currency-rates auto-pull.

  Compliance angle: a worker fat-fingering a EUR→GBP rate at
  company-setup time corrupts every multi-currency invoice for the
  quarter. Rates are a published external feed, not a worker decision
  — so the system pulls them from the European Central Bank
  reference-rates XML and writes them straight into the company
  record. Admins can still flip the toggle off and manage manually.

  Schedule: daily at 08:00 UTC. ECB publishes the previous business
  day's rates around 16:00 CET (15:00 UTC), so a morning pull is
  guaranteed-fresh and avoids a same-second race against the publish.

  Oban isn't in the dep tree (see `mix.exs`), so this is a plain
  GenServer that reschedules itself with `Process.send_after/3`. If
  the BEAM restarts mid-day, the next tick fires at the next 08:00
  UTC; an opt-in immediate catch-up runs on boot via
  `:run_on_boot` config so a deploy that crossed 08:00 still gets the
  latest rates.

  ## Idempotency

  Two pulls on the same UTC day are safe: the second sees the same
  rates (the feed only refreshes once / business day), writes the same
  values, and produces an audit "updated" row with an empty diff —
  which the audit module skips entirely (`record_updated/5` returns
  `:noop` when `map_size(diff) == 0`).
  """

  use GenServer
  require Logger

  alias Backend.Companies
  alias Backend.Companies.Company
  alias Backend.Repo
  alias Backend.Workers.EcbClient

  @cron_hour 8
  @cron_minute 0
  @system_actor %{kind: "system", name: "ECB auto-pull", source: "ecb_auto"}

  # ---- Public API -----------------------------------------------------

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc """
  Trigger a pull right now from anywhere. Synchronous — used by the
  Mix script and by tests that want a deterministic result.
  """
  @spec run_now(keyword()) :: {:ok, map()} | {:error, term()}
  def run_now(opts \\ []) do
    do_pull(opts)
  end

  # ---- GenServer ------------------------------------------------------

  @impl true
  def init(opts) do
    enabled? = Keyword.get(opts, :enabled, Application.get_env(:backend, __MODULE__, [])[:enabled] != false)

    if enabled? do
      if Keyword.get(opts, :run_on_boot, false), do: send(self(), :tick)
      schedule_next_tick()
    end

    {:ok, %{enabled: enabled?}}
  end

  @impl true
  def handle_info(:tick, state) do
    # Pull happens in a Task so a slow ECB response can't wedge the
    # GenServer for 15s — the next tick is already scheduled.
    Task.start(fn -> do_pull([]) end)
    schedule_next_tick()
    {:noreply, state}
  end

  # ---- Implementation -------------------------------------------------

  defp do_pull(opts) do
    case EcbClient.fetch(opts) do
      {:ok, %{rates: eur_rates}} ->
        process_all_companies(eur_rates, opts)

      {:error, reason} ->
        Logger.error("[CurrencyRatesPull] ECB fetch failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  defp process_all_companies(eur_rates, opts) do
    pulled_at = Keyword.get(opts, :pulled_at, DateTime.utc_now())

    companies =
      Repo.all(Company)
      |> Enum.filter(& &1.currency_rates_auto_pull)

    results =
      Enum.map(companies, fn company ->
        case process_company(company, eur_rates, pulled_at) do
          {:ok, updated} ->
            Logger.info(
              "[CurrencyRatesPull] company=#{company.id} base=#{company.currency_code} rates=#{map_size(eur_rates)}"
            )

            {:ok, updated}

          {:error, reason} = err ->
            Logger.error(
              "[CurrencyRatesPull] company=#{company.id} failed: #{inspect(reason)}"
            )

            err
        end
      end)

    skipped = Repo.aggregate(Company, :count, :id) - length(companies)

    if skipped > 0 do
      Logger.info("[CurrencyRatesPull] skipped=#{skipped} (auto-pull disabled)")
    end

    {:ok, %{processed: length(results), skipped: skipped, results: results}}
  end

  defp process_company(%Company{} = company, eur_rates, pulled_at) do
    base = company.currency_code

    case rebase(eur_rates, base) do
      {:ok, rebased} ->
        bag = %{
          "rates" =>
            rebased
            |> Enum.map(fn {cur, rate} -> %{"currency" => cur, "rate" => Decimal.to_string(rate, :normal)} end)
            |> Enum.sort_by(& &1["currency"])
        }

        Companies.update_currency_rates(company, bag,
          source: "ecb_auto",
          pulled_at: pulled_at,
          actor: @system_actor
        )

      err ->
        err
    end
  end

  @doc """
  Re-base an `EUR=1` rate map onto a different ISO 4217 code. If the
  company's base is already EUR, this is a no-op (EUR itself is
  dropped from the output since `1 EUR = 1 EUR` is noise). If the
  base is e.g. GBP, every other rate is divided by the EUR→GBP rate
  so the bag reads "1 GBP = X CCY".

  Returns `{:error, :unknown_base_currency}` if the company's base
  isn't in the feed — defensive guard against an admin picking an
  exotic currency code we can't quote against.
  """
  @spec rebase(EcbClient.rate_map(), String.t()) ::
          {:ok, EcbClient.rate_map()} | {:error, :unknown_base_currency}
  def rebase(eur_rates, base) when is_binary(base) do
    base_upper = String.upcase(base)

    case Map.fetch(eur_rates, base_upper) do
      {:ok, base_rate} ->
        # `decimals: 8` is the precision we lose nothing meaningful at:
        # ECB publishes 4 dp, dividing two 4 dp numbers still fits in 8.
        rebased =
          eur_rates
          |> Map.delete(base_upper)
          |> Enum.into(%{}, fn {cur, rate} ->
            {cur, Decimal.round(Decimal.div(rate, base_rate), 8, :half_up)}
          end)

        {:ok, rebased}

      :error ->
        {:error, :unknown_base_currency}
    end
  end

  # Schedule the next fire at 08:00 UTC. If we're already past 08:00
  # today, target 08:00 tomorrow. Stored as monotonic millis so DST /
  # wall-clock drift can't cause a double-fire.
  defp schedule_next_tick do
    delay_ms = ms_until_next_run(DateTime.utc_now())
    Process.send_after(self(), :tick, delay_ms)
  end

  @doc false
  def ms_until_next_run(%DateTime{} = now) do
    today_target =
      %DateTime{
        now
        | hour: @cron_hour,
          minute: @cron_minute,
          second: 0,
          microsecond: {0, 0}
      }

    target =
      if DateTime.compare(now, today_target) == :lt do
        today_target
      else
        DateTime.add(today_target, 86_400, :second)
      end

    DateTime.diff(target, now, :millisecond)
  end
end
