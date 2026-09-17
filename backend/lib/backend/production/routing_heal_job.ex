defmodule Backend.Production.RoutingHealJob do
  @moduledoc """
  GenServer that periodically wakes up and calls
  `Backend.Production.RoutingHealer.heal_all/0`.

  Cadence: 5 min after boot (so the app is warm and any migrations
  have settled), then every 24 h. Both configurable via:

      config :backend, Backend.Production.RoutingHealJob,
        start: true,        # false in test
        boot_delay_ms: 300_000,
        interval_ms: 86_400_000

  Silent-degrade: the entire tick is wrapped in a rescue so a bad
  routing step never crashes the job process and starves the sweep.
  Logs a one-line summary per tick — routing changes are audited
  in the `routing_heal_events` table so verbose per-step logging
  here would be redundant noise.
  """

  use GenServer
  require Logger

  alias Backend.Production.RoutingHealer

  @default_boot_delay 300_000
  @default_interval 86_400_000

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(opts) do
    cfg = Application.get_env(:backend, __MODULE__, [])
    boot_delay = Keyword.get(opts, :boot_delay_ms, cfg[:boot_delay_ms] || @default_boot_delay)
    interval = Keyword.get(opts, :interval_ms, cfg[:interval_ms] || @default_interval)
    Process.send_after(self(), :tick, boot_delay)
    {:ok, %{interval_ms: interval}}
  end

  @impl true
  def handle_info(:tick, state) do
    _ = safe_run()
    Process.send_after(self(), :tick, state.interval_ms)
    {:noreply, state}
  end

  @doc "One-shot for tests / ops IEx. Returns the healer stats map."
  def run_now, do: safe_run()

  defp safe_run do
    try do
      stats = RoutingHealer.heal_all()

      Logger.info(
        "RoutingHealJob tick: " <>
          "total=#{stats.total} regression=#{stats.regression} " <>
          "median=#{stats.median} insufficient=#{stats.insufficient} " <>
          "locked=#{stats.locked} errors=#{stats.errors}"
      )

      stats
    rescue
      err ->
        Logger.warning("RoutingHealJob tick failed (rescued): #{inspect(err)}")
        %{total: 0, errors: 1}
    catch
      kind, reason ->
        Logger.warning(
          "RoutingHealJob tick caught #{inspect(kind)} #{inspect(reason)}"
        )

        %{total: 0, errors: 1}
    end
  end
end
