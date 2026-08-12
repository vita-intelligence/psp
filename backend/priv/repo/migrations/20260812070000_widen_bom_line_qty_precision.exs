defmodule Backend.Repo.Migrations.WidenBomLineQtyPrecision do
  use Ecto.Migration

  # ``bom_lines.qty`` was ``numeric(14,4)`` — 4 decimals in whatever
  # source unit the line stored. That's fine for kg / L / count but
  # for trace ingredients stored in kg (or mg-quantities scaled up)
  # a legitimate 0.00005 kg (= 50 mg) was quantized to ``0.0000``
  # at write time, silently dropped, and rendered as "0 kg" on every
  # downstream surface (MO parts table, procurement calcs, cost
  # rollups).
  #
  # Widening to ``numeric(20,10)`` fits:
  #
  #   * 10 decimals → 0.1 pg precision when stored in mg,
  #                   0.1 ng precision when stored in g,
  #                   0.1 ug precision when stored in kg.
  #     Well below any real-world recipe threshold — a supplement
  #     ingredient measured at picogram levels is science fiction.
  #   * 10 integer digits → up to 10 billion of the source unit,
  #                          matches the widest MO qty range we ever
  #                          book against (bulk oil / powder runs).
  #
  # Widening is a compatible ``ALTER TYPE`` on Postgres — existing
  # numeric(14,4) values fit exactly in numeric(20,10) with no data
  # loss and no need to rewrite the table (Postgres 12+ short-circuits
  # widening within the same base type).
  def change do
    alter table(:bom_lines) do
      modify :qty, :decimal, precision: 20, scale: 10, from: {:decimal, precision: 14, scale: 4}
    end
  end
end
