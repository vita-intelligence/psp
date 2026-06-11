defmodule Backend.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      BackendWeb.Telemetry,
      Backend.Repo,
      {DNSCluster, query: Application.get_env(:backend, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Backend.PubSub},
      BackendWeb.Presence,
      # Daily ECB currency-rates auto-pull. Disabled in test (the
      # GenServer would fight the SQL sandbox); started in dev / prod.
      # Per-run config (`:enabled`, `:run_on_boot`, Req plug for
      # mocking) lives in `config/runtime.exs`.
      currency_rates_pull_child(),
      # Start to serve requests, typically the last entry
      BackendWeb.Endpoint
    ]
    |> Enum.reject(&is_nil/1)

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Backend.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    BackendWeb.Endpoint.config_change(changed, removed)
    :ok
  end

  # Returns the worker child spec when the env-driven gate is on, else
  # nil so the supervisor skips it. Test config flips the gate off.
  defp currency_rates_pull_child do
    cfg = Application.get_env(:backend, Backend.Workers.CurrencyRatesPull, [])

    if Keyword.get(cfg, :start, true) do
      {Backend.Workers.CurrencyRatesPull, Keyword.take(cfg, [:enabled, :run_on_boot])}
    end
  end
end
