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
