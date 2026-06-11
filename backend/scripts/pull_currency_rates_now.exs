# Triggers the ECB currency-rates pull immediately for every company
# that has `currency_rates_auto_pull = true`. Useful for first-time
# setup (no rates have ever been pulled) or when an admin needs to
# refresh ahead of the 08:00 UTC cron after a base-currency change.
#
# Run with:  mix run scripts/pull_currency_rates_now.exs

alias Backend.Workers.CurrencyRatesPull

IO.puts("Pulling ECB currency rates…")

case CurrencyRatesPull.run_now() do
  {:ok, %{processed: n, skipped: skipped}} ->
    IO.puts("✓ Pulled rates for #{n} compan#{if n == 1, do: "y", else: "ies"}.")
    if skipped > 0, do: IO.puts("  (#{skipped} skipped — auto-pull disabled.)")

  {:error, reason} ->
    IO.puts(:stderr, "✗ Pull failed: #{inspect(reason)}")
    System.halt(1)
end
