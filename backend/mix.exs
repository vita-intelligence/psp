defmodule Backend.MixProject do
  use Mix.Project

  def project do
    [
      app: :backend,
      version: "0.1.0",
      elixir: "~> 1.15",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      aliases: aliases(),
      deps: deps(),
      listeners: [Phoenix.CodeReloader]
    ]
  end

  # Configuration for the OTP application.
  #
  # Type `mix help compile.app` for more information.
  def application do
    [
      mod: {Backend.Application, []},
      extra_applications: [:logger, :runtime_tools]
    ]
  end

  def cli do
    [
      preferred_envs: [precommit: :test]
    ]
  end

  # Specifies which paths to compile per environment.
  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  # Specifies your project dependencies.
  #
  # Type `mix help deps` for examples and options.
  defp deps do
    [
      {:phoenix, "~> 1.8.7"},
      {:phoenix_ecto, "~> 4.5"},
      {:ecto_sql, "~> 3.13"},
      {:postgrex, ">= 0.0.0"},
      {:phoenix_live_dashboard, "~> 0.8.3"},
      {:swoosh, "~> 1.16"},
      {:req, "~> 0.5"},
      {:telemetry_metrics, "~> 1.0"},
      {:telemetry_poller, "~> 1.0"},
      {:gettext, "~> 1.0"},
      {:jason, "~> 1.2"},
      {:dns_cluster, "~> 0.2.0"},
      {:bandit, "~> 1.5"},
      {:bcrypt_elixir, "~> 3.1"},
      {:cors_plug, "~> 3.0"},
      # Headless Chrome PDF renderer for PO / Delivery note / RFQ
      # documents. Uses the system Chrome binary in dev (mac picks up
      # /Applications/Google Chrome.app automatically) and is started
      # under our supervision tree with a small pool — see
      # `Backend.Application`.
      {:chromic_pdf, "~> 1.17"},
      # Elixir/Phoenix SAST. Run via `mix sobelow --config` — the
      # rules and skip-list live in `.sobelow-conf`. CI-only dep so
      # production releases don't bundle it.
      {:sobelow, "~> 0.13", only: [:dev, :test], runtime: false},
      # Cross-refs Hex deps against the GitHub Advisory Database.
      # Stricter than the built-in `mix hex.audit` (which only sees
      # Hex retirement notices). CI-only.
      {:mix_audit, "~> 2.1", only: [:dev, :test], runtime: false},
      # RFC 6238 TOTP verification for MFA. Small, zero-dependency;
      # runtime because AuthController + Backend.MFA use it.
      {:nimble_totp, "~> 1.0"},
      # Encryption-at-rest for sensitive columns (TOTP secret, tax
      # numbers, payment details). Vault lives in the supervision
      # tree and dispatches to the current cipher; Ecto field types
      # under `Backend.Encrypted.*` handle the read/write plumbing.
      {:cloak, "~> 1.1"},
      {:cloak_ecto, "~> 1.3"}
    ]
  end

  # Aliases are shortcuts or tasks specific to the current project.
  # For example, to install project dependencies and perform other setup tasks, run:
  #
  #     $ mix setup
  #
  # See the documentation for `Mix` for more info on aliases.
  defp aliases do
    [
      setup: ["deps.get", "ecto.setup"],
      "ecto.setup": ["ecto.create", "ecto.migrate", "run priv/repo/seeds.exs"],
      "ecto.reset": ["ecto.drop", "ecto.setup"],
      test: ["ecto.create --quiet", "ecto.migrate --quiet", "test"],
      # Pure-module security regression suite — runs without Postgres
      # (useful when Docker isn't up locally). Exercises the classes
      # that don't need seeded data: filename escaping, MIME sniffing,
      # CSV formula neutralisation, atom-injection sort, ETS rate
      # limiter.
      #
      # The DB-backed security tests (`test/security/tenancy_test.exs`,
      # `form_channel_security_test.exs`, `page_channel_security_test.exs`,
      # `token_revocation_test.exs`, `auth_rate_limit_test.exs`) run
      # via the normal `mix test` once the sandbox DB is up.
      "test.security.pure": ["run --no-start test/security/support/run_pure.exs"],
      # Sobelow SAST scan — reads `.sobelow-conf`. Wired into the CI
      # workflow; run locally with `mix sobelow --config`.
      sobelow: ["sobelow --config"],
      # Combined security pass: Sobelow SAST, hex advisory audit,
      # and the DB-free regression suite. Use before pushing
      # security-adjacent changes. (The strict-warnings compile step
      # is a separate concern — invoke it via `mix precommit` when
      # you want the full pre-flight.)
      "security.scan": [
        "sobelow --config",
        # `hex.audit` = Hex retirement notices only. `deps.audit` =
        # GH Advisory Database (from mix_audit) — stricter, catches
        # published CVEs.
        "hex.audit",
        "deps.audit",
        "test.security.pure"
      ],
      precommit: ["compile --warnings-as-errors", "deps.unlock --unused", "format", "test"]
    ]
  end
end
