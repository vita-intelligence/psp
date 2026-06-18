defmodule Backend.Companies.Company do
  @moduledoc """
  The Company schema — a singleton row per PSP deployment that holds
  every global setting (identity, locale, working hours, holidays,
  currency rates, allowed IPs, numbering formats).

  List-shaped settings live in JSONB bags rather than join tables so
  we can update them atomically with `Repo.update/1` and avoid
  fan-out queries.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.RBAC.Role

  @date_formats ~w(dd/MM/yyyy MM/dd/yyyy yyyy-MM-dd dd.MM.yyyy)
  @separators ~w(. , ; |)
  @currencies ~w(GBP EUR USD JPY INR CHF CAD AUD)

  schema "companies" do
    field :name, :string
    field :legal_address, :string
    field :email, :string
    field :website, :string
    field :phone, :string
    field :registration_number, :string
    field :tax_number, :string
    field :tax_rate, :decimal
    field :payment_details, :string

    field :timezone, :string, default: "Europe/London"
    field :date_format, :string, default: "dd/MM/yyyy"
    field :first_day_of_week, :integer, default: 1
    field :decimal_separator, :string, default: "."
    field :thousands_separator, :string, default: ","
    field :csv_separator, :string, default: ","
    field :currency_code, :string, default: "GBP"
    field :currency_format, :string, default: "[Sign] [Price]"
    field :generic_place_name, :string, default: "Holding Room"

    field :working_hours, :map, default: %{}
    field :holidays, :map, default: %{}
    field :currency_rates, :map, default: %{}
    field :allowed_ips, :map, default: %{}
    field :numbering_formats, :map, default: %{}

    # Default warehouse-pickup visibility window (hours). Once a
    # planner releases an MO to the warehouse, it appears on the
    # picker page from `planned_start - default_pickup_window_hours`
    # onward. Per-MO override on the MO row; per-MO release modal
    # prefills with this value.
    field :default_pickup_window_hours, :integer, default: 24

    # ECB auto-pull controls live alongside the rates bag rather than
    # inside it: cron writes / reads these without round-tripping
    # JSONB, and the FE can render "last pulled at HH:MM" without
    # parsing the bag itself.
    field :currency_rates_auto_pull, :boolean, default: true
    field :currency_rates_pulled_at, :utc_datetime
    field :currency_rates_source, :string, default: "manual"

    has_many :roles, Role
    has_many :users, User

    timestamps(type: :utc_datetime)
  end

  def known_date_formats, do: @date_formats
  def known_separators, do: @separators
  def known_currencies, do: @currencies

  @doc "Validate the bare-minimum identity for the bootstrap row."
  def bootstrap_changeset(company, attrs) do
    company
    |> cast(attrs, [:name])
    |> validate_required([:name])
    |> validate_length(:name, min: 1, max: 200)
    |> unique_constraint(:name)
  end

  @doc "Identity card update — what the Company General settings screen edits."
  def identity_changeset(company, attrs) do
    company
    |> cast(attrs, [
      :name,
      :legal_address,
      :email,
      :website,
      :phone,
      :registration_number,
      :tax_number,
      :tax_rate,
      :payment_details
    ])
    |> validate_required([:name])
    |> validate_length(:name, min: 1, max: 200)
    |> validate_length(:email, max: 160)
    |> validate_format(:email, ~r/^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      message: "invalid email"
    )
    |> validate_number(:tax_rate,
      greater_than_or_equal_to: 0,
      less_than_or_equal_to: 100
    )
    |> unique_constraint(:name)
  end

  @doc "Locale card update — separators, currency code, etc."
  def locale_changeset(company, attrs) do
    company
    |> cast(attrs, [
      :timezone,
      :date_format,
      :first_day_of_week,
      :decimal_separator,
      :thousands_separator,
      :csv_separator,
      :currency_code,
      :currency_format,
      :generic_place_name
    ])
    |> validate_required([
      :timezone,
      :date_format,
      :first_day_of_week,
      :decimal_separator,
      :thousands_separator,
      :csv_separator,
      :currency_code
    ])
    |> validate_inclusion(:date_format, @date_formats)
    |> validate_inclusion(:decimal_separator, @separators)
    |> validate_inclusion(:thousands_separator, @separators)
    |> validate_inclusion(:csv_separator, @separators)
    |> validate_inclusion(:currency_code, @currencies)
    |> validate_inclusion(:first_day_of_week, 0..6)
    |> validate_different_separators()
  end

  @doc """
  Warehouse-pickup card update — currently just the default visibility
  window. Sits on its own changeset so the FE save form has a clean
  scope and audit captures the change distinct from locale edits.
  """
  def warehouse_pickup_changeset(company, attrs) do
    company
    |> cast(attrs, [:default_pickup_window_hours])
    |> validate_required([:default_pickup_window_hours])
    |> validate_number(:default_pickup_window_hours, greater_than: 0)
    |> check_constraint(:default_pickup_window_hours,
      name: :companies_default_pickup_window_positive,
      message: "must be greater than zero"
    )
  end

  @currency_rates_sources ~w(manual ecb_auto)

  @doc """
  Toggle the auto-pull flag without touching the rates bag itself.
  Cron writes the rates separately via `update_currency_rates/3` which
  also stamps `currency_rates_pulled_at` + `currency_rates_source`.
  """
  def auto_pull_changeset(company, attrs) do
    company
    |> cast(attrs, [:currency_rates_auto_pull])
    |> validate_required([:currency_rates_auto_pull])
  end

  @doc """
  Cron-write of the rates bag together with provenance. Used only by
  `Backend.Companies.update_currency_rates/3`; not exposed to the FE.
  """
  def system_currency_rates_changeset(company, attrs) do
    company
    |> cast(attrs, [
      :currency_rates,
      :currency_rates_pulled_at,
      :currency_rates_source
    ])
    |> validate_inclusion(:currency_rates_source, @currency_rates_sources)
  end

  defp validate_different_separators(changeset) do
    decimal = get_field(changeset, :decimal_separator)
    thousands = get_field(changeset, :thousands_separator)

    if decimal && thousands && decimal == thousands do
      add_error(
        changeset,
        :thousands_separator,
        "must differ from the decimal separator"
      )
    else
      changeset
    end
  end
end
