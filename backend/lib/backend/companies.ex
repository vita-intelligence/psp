defmodule Backend.Companies do
  @moduledoc """
  Boundary for the Company singleton.

  PSP is single-tenant per deployment: there's one row in the
  `companies` table, created lazily the first time `current/0` is
  called (typically during the first user's registration). Multi-
  company is a future migration.

  Settings are split across:

    * Identity fields (name, address, email, phone, registration, VAT…)
    * Locale fields (timezone, separators, currency, date format)
    * Five JSONB bags for list-shaped settings (working hours, holidays,
      currency rates, allowed IPs, numbering formats).
  """

  import Ecto.Query, warn: false
  alias Backend.Audit
  alias Backend.Repo
  alias Backend.Companies.Company

  @default_name "Vita Manufacture Limited"

  @doc """
  Return the singleton Company row, creating it with default values
  on first call. Idempotent.
  """
  def current do
    case Repo.one(Company) do
      %Company{} = c ->
        c

      nil ->
        {:ok, company} =
          %Company{}
          |> Company.bootstrap_changeset(%{name: @default_name})
          |> Repo.insert()

        # No system roles to seed: access is per-user
        # (`is_admin` + `permissions`). Admins create their own
        # permission templates as needed.
        #
        # Units of measurement DO get pre-seeded — every tenant needs
        # kg / g / L / pcs / m to be useful out of the box, so we
        # don't make admins type them in. Idempotent via the
        # (company_id, symbol) unique index.
        Backend.Units.seed_defaults_for_company(company.id)

        company
    end
  end

  def get!(id), do: Repo.get!(Company, id)

  def update_identity(%Company{} = company, attrs) do
    company
    |> Company.identity_changeset(attrs)
    |> Repo.update()
  end

  def update_locale(%Company{} = company, attrs) do
    company
    |> Company.locale_changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Flip the company-wide MFA-required toggle.

  When flipping FROM off TO on, every user in the company who hasn't
  finished enrollment gets `mfa_required_at` stamped so their 7-day
  grace window starts. Already-enrolled users are untouched.

  When flipping FROM on TO off, we clear `mfa_required_at` on every
  user so the settings screen doesn't keep showing stale grace
  deadlines. Enrolled users keep their MFA active — disable is a
  per-user action.

  Runs in a transaction so a partial write can't leave the toggle
  and the user rows out of sync.
  """
  def update_security(%Company{} = company, attrs) do
    Repo.transaction(fn ->
      case company
           |> Company.security_changeset(attrs)
           |> Repo.update() do
        {:ok, updated} ->
          _ = sync_user_mfa_required(company, updated)
          updated

        {:error, cs} ->
          Repo.rollback(cs)
      end
    end)
  end

  # `previous` = the company row we read before the changeset ran.
  # `updated`  = the row after. We only touch the users table when the
  # `require_mfa` bit actually changed.
  defp sync_user_mfa_required(previous, updated) do
    cond do
      previous.require_mfa == updated.require_mfa ->
        {0, nil}

      updated.require_mfa ->
        now = DateTime.utc_now() |> DateTime.truncate(:second)

        import Ecto.Query, only: [from: 2]

        from(u in Backend.Accounts.User,
          where:
            u.company_id == ^updated.id and
              is_nil(u.totp_confirmed_at) and
              is_nil(u.mfa_required_at)
        )
        |> Repo.update_all(set: [mfa_required_at: now])

      true ->
        import Ecto.Query, only: [from: 2]

        from(u in Backend.Accounts.User, where: u.company_id == ^updated.id)
        |> Repo.update_all(set: [mfa_required_at: nil])
    end
  end

  @doc """
  Warehouse-pickup defaults — currently just the default visibility
  window for released MOs. Per-MO override lives on the MO row.
  """
  def update_warehouse_pickup(%Company{} = company, attrs) do
    company
    |> Company.warehouse_pickup_changeset(attrs)
    |> Repo.update()
  end

  @doc """
  3PL storage rate — persisted in company base currency, applied to
  every bailee lot from `bailee_routed_at` until dispatch. Passing
  `nil` clears the rate (settings card exposes an explicit "no rate"
  state so accidentally saving zero doesn't silently charge £0.00
  either).
  """
  def update_three_pl_rate(%Company{} = company, attrs) do
    company
    |> Company.three_pl_rate_changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Replace any of the JSONB bags atomically. Caller is responsible for
  validating the shape it's writing — we just stash it.

  Note for `:numbering_formats`: display codes are rendered on the fly
  from `prefix + lpad(id, padding)` in `BackendWeb.Payloads`, so saving
  a new format takes effect across every payload immediately without
  any row rewrites.
  """
  def update_bag(%Company{} = company, field, value)
      when field in [
             :working_hours,
             :holidays,
             :currency_rates,
             :allowed_ips,
             :numbering_formats
           ] do
    company
    |> Ecto.Changeset.change(%{field => value})
    |> Repo.update()
  end

  @doc """
  Flip the ECB auto-pull toggle. Audit-logged under the user who
  toggled. Rate values are NOT touched here — the next cron tick (or a
  manual save while auto-pull is off) handles those.
  """
  def update_auto_pull(%Company{} = company, attrs, actor \\ nil) do
    before_state = %{currency_rates_auto_pull: company.currency_rates_auto_pull}

    company
    |> Company.auto_pull_changeset(attrs)
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(
          actor,
          "company",
          audit_entity(updated),
          before_state,
          %{currency_rates_auto_pull: updated.currency_rates_auto_pull}
        )

        {:ok, updated}

      err ->
        err
    end
  end

  @doc """
  Cron-write of the company's currency rates bag. `rates` is the bag
  shape the FE form already uses — `%{"rates" => [%{currency, rate}]}`
  — so a subsequent manual edit can pick up exactly where the cron
  left off without an extra translation layer.

  Opts:
    * `:source` — `"ecb_auto"` (cron) or `"manual"` (admin save).
                 Default `"manual"` so accidental misuse from a
                 controller can't masquerade as a system write.
    * `:pulled_at` — UTC datetime to stamp; defaults to `now`.
    * `:actor` — `%User{}` for manual writes, or
                 `%{kind: "system", name: "..."}` for cron writes.

  Audit semantics: only `currency_rates` + `currency_rates_source`
  participate in the field-level diff. `pulled_at` is intentionally
  excluded so a same-day re-pull (identical rates, fresh timestamp)
  collapses to `:noop` and the history doesn't grow with no-op rows.
  """
  def update_currency_rates(%Company{} = company, rates, opts \\ []) do
    source = Keyword.get(opts, :source, "manual")
    pulled_at = Keyword.get(opts, :pulled_at, DateTime.utc_now())
    actor = Keyword.get(opts, :actor)

    pulled_at = DateTime.truncate(pulled_at, :second)

    # `pulled_at` is deliberately excluded from the audit before/after
    # snapshots — it would otherwise change every tick and defeat the
    # `record_updated/5` :noop guard, spamming the history with
    # identical-rate rows. The audit `state_after` still embeds it
    # via `metadata` for the history view to read.
    before_state = %{
      currency_rates: company.currency_rates,
      currency_rates_source: company.currency_rates_source
    }

    attrs = %{
      currency_rates: rates,
      currency_rates_source: source,
      currency_rates_pulled_at: pulled_at
    }

    company
    |> Company.system_currency_rates_changeset(attrs)
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        audit_after = %{
          currency_rates: updated.currency_rates,
          currency_rates_source: updated.currency_rates_source
        }

        Audit.record_updated(
          actor,
          "company",
          audit_entity(updated),
          before_state,
          audit_after
        )

        {:ok, updated}

      err ->
        err
    end
  end

  # The audit module derives `company_id` from `entity.company_id`,
  # which isn't set on the singleton Company row (it IS the company).
  # Tag the entity with its own id so the audit insert satisfies
  # `audit_events.company_id NOT NULL` and history queries scope
  # correctly.
  defp audit_entity(%Company{} = company),
    do: Map.put(company, :company_id, company.id)
end
