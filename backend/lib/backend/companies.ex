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

  Special case for `:numbering_formats`: after writing the new bag, we
  re-stamp existing rows whose code follows the OLD `<prefix><digits>`
  pattern. That makes "change PT to PTTT" actually rename your existing
  templates from `PT00001` to `PTTT00001` instead of leaving them
  stranded with the old prefix. Custom-typed codes (anything that
  doesn't match the old standard pattern) are left untouched.
  """
  def update_bag(%Company{} = company, field, value)
      when field in [
             :working_hours,
             :holidays,
             :currency_rates,
             :allowed_ips,
             :numbering_formats
           ] do
    old_value = Map.get(company, field)

    Repo.transaction(fn ->
      case company
           |> Ecto.Changeset.change(%{field => value})
           |> Repo.update() do
        {:ok, updated} ->
          if field == :numbering_formats do
            re_stamp_codes(updated, old_value || %{}, value || %{})
          end

          updated

        {:error, cs} ->
          Repo.rollback(cs)
      end
    end)
    |> case do
      {:ok, updated} -> {:ok, updated}
      {:error, %Ecto.Changeset{} = cs} -> {:error, cs}
    end
  end

  ## ----- numbering re-stamp ----------------------------------------

  defp re_stamp_codes(%Company{} = company, old_formats, new_formats) do
    for {entity_key, schema} <- Backend.Numbering.entity_schemas() do
      old_fmt = Map.get(old_formats, entity_key) || %{}
      new_fmt = Map.get(new_formats, entity_key) || %{}

      cond do
        new_fmt == %{} ->
          :skip

        old_fmt["prefix"] == new_fmt["prefix"] and
            old_fmt["padding"] == new_fmt["padding"] ->
          :skip

        true ->
          re_stamp_entity(company, schema, old_fmt, new_fmt)
      end
    end
  end

  # One SQL statement per affected entity. Postgres extracts the
  # trailing digits, casts to int, re-pads with the new width, and
  # prepends the new prefix — all in a single UPDATE pass. O(N) on
  # the row count but server-side and indexed via (company_id, code),
  # so even 100k rows is well under a second. Rows whose code doesn't
  # match the old standard pattern (custom-typed codes) are excluded
  # by the WHERE regex and left untouched.
  defp re_stamp_entity(company, schema, old_fmt, new_fmt) do
    old_prefix = old_fmt["prefix"] || ""
    new_prefix = new_fmt["prefix"] || ""
    new_padding = new_fmt["padding"] || Backend.Numbering.default_padding()

    table = schema.__schema__(:source)
    old_pattern = "^" <> Regex.escape(old_prefix) <> "\\d+$"

    sql = """
    UPDATE #{table}
    SET code = $1 || lpad((substring(code from '\\d+$'))::int::text, $2, '0')
    WHERE company_id = $3
      AND code IS NOT NULL
      AND code ~ $4
    """

    Repo.query!(sql, [new_prefix, new_padding, company.id, old_pattern])
  end
end
