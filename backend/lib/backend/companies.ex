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
  Replace any of the JSONB bags atomically. Caller is responsible for
  validating the shape it's writing — we just stash it.
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
end
