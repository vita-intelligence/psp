defmodule Backend.Units.UnitOfMeasurement do
  @moduledoc """
  Company-scoped registry of units used for stock + recipes. Within a
  dimension (`mass`, `volume`, `count`, `length`, `area`, `time`) one
  unit is `is_base=true` (factor 1) and every other unit converts to
  it via a single multiply by `factor_to_base`. No graph traversal,
  no contradictions possible.

  Per-item pack sizes ("1 case of Vitamin D = 12 bottles") are NOT a
  unit — they belong on the item record when items land. This table
  is only the global registry.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company

  @valid_dimensions ~w(mass volume count length area time)

  schema "units_of_measurement" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :name, :string
    field :symbol, :string
    field :dimension, :string
    field :factor_to_base, :decimal
    field :is_base, :boolean, default: false
    field :is_active, :boolean, default: true

    belongs_to :company, Company
    belongs_to :created_by, User
    belongs_to :updated_by, User

    timestamps(type: :utc_datetime)
  end

  def valid_dimensions, do: @valid_dimensions

  def changeset(unit, attrs) do
    unit
    |> cast(attrs, [
      :company_id,
      :name,
      :symbol,
      :dimension,
      :factor_to_base,
      :is_base,
      :is_active,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([
      :company_id,
      :name,
      :symbol,
      :dimension,
      :factor_to_base
    ])
    |> normalise_symbol()
    |> normalise_name()
    |> validate_length(:name, min: 1, max: 60)
    |> validate_length(:symbol, min: 1, max: 12)
    |> validate_inclusion(:dimension, @valid_dimensions,
      message: "must be one of: #{Enum.join(@valid_dimensions, ", ")}"
    )
    |> validate_factor()
    |> validate_base_has_factor_one()
    |> unique_constraint([:company_id, :symbol],
      name: :units_of_measurement_company_id_symbol_index,
      message: "this symbol is already in use"
    )
    |> unique_constraint([:company_id, :name],
      name: :units_of_measurement_company_id_name_index,
      message: "this name is already in use"
    )
    |> unique_constraint([:company_id, :dimension],
      name: :units_of_measurement_one_base_per_dimension,
      message: "another unit is already the base for this dimension"
    )
  end

  defp normalise_symbol(changeset) do
    case get_change(changeset, :symbol) do
      raw when is_binary(raw) -> put_change(changeset, :symbol, String.trim(raw))
      _ -> changeset
    end
  end

  defp normalise_name(changeset) do
    case get_change(changeset, :name) do
      raw when is_binary(raw) -> put_change(changeset, :name, String.trim(raw))
      _ -> changeset
    end
  end

  defp validate_factor(changeset) do
    case get_field(changeset, :factor_to_base) do
      %Decimal{} = d ->
        if Decimal.positive?(d) do
          changeset
        else
          add_error(changeset, :factor_to_base, "must be greater than zero")
        end

      _ ->
        changeset
    end
  end

  # The base unit *defines* its dimension's scale, so its factor
  # must be exactly 1. Reject inconsistent input early so a typo
  # can't silently make every conversion 10× off.
  defp validate_base_has_factor_one(changeset) do
    if get_field(changeset, :is_base) do
      case get_field(changeset, :factor_to_base) do
        %Decimal{} = d ->
          if Decimal.equal?(d, Decimal.new(1)) do
            changeset
          else
            add_error(
              changeset,
              :factor_to_base,
              "base unit must have factor 1"
            )
          end

        _ ->
          changeset
      end
    else
      changeset
    end
  end
end
