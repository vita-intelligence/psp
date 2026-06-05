defmodule Backend.Repo.Migrations.SeedDefaultUnitsForExistingCompanies do
  use Ecto.Migration
  import Ecto.Query

  @moduledoc """
  One-shot data migration: seed the SI-aligned default units for any
  companies that already exist (i.e. the singleton in dev / prod that
  predates the units_of_measurement table). New companies seed via
  `Backend.Companies.current/0` so this only matters once.
  """

  def up do
    now = DateTime.utc_now() |> DateTime.truncate(:second)
    repo = repo()

    company_ids =
      repo.all(from(c in "companies", select: c.id))

    Enum.each(company_ids, fn company_id ->
      rows =
        Enum.map(default_seed_rows(), fn row ->
          row
          |> Map.put(:company_id, company_id)
          |> Map.put(:inserted_at, now)
          |> Map.put(:updated_at, now)
        end)

      repo.insert_all(
        "units_of_measurement",
        rows,
        on_conflict: :nothing,
        conflict_target: [:company_id, :symbol]
      )
    end)
  end

  def down do
    # Best-effort rollback: remove only the rows that match the seeded
    # symbols, leaving any user-added units intact.
    repo = repo()
    symbols = Enum.map(default_seed_rows(), & &1.symbol)

    repo.delete_all(
      from(u in "units_of_measurement", where: u.symbol in ^symbols)
    )
  end

  defp default_seed_rows do
    [
      row("Kilogram", "kg", "mass", "1", true),
      row("Gram", "g", "mass", "0.001", false),
      row("Milligram", "mg", "mass", "0.000001", false),
      row("Pound", "lb", "mass", "0.453592370", false),
      row("Ounce", "oz", "mass", "0.028349523", false),
      row("Litre", "L", "volume", "1", true),
      row("Millilitre", "mL", "volume", "0.001", false),
      row("Pieces", "pcs", "count", "1", true),
      row("Dozen", "dozen", "count", "12", false),
      row("Metre", "m", "length", "1", true),
      row("Centimetre", "cm", "length", "0.01", false),
      row("Millimetre", "mm", "length", "0.001", false)
    ]
  end

  defp row(name, symbol, dimension, factor, is_base) do
    %{
      uuid: Ecto.UUID.bingenerate(),
      name: name,
      symbol: symbol,
      dimension: dimension,
      factor_to_base: Decimal.new(factor),
      is_base: is_base,
      is_active: true
    }
  end
end
