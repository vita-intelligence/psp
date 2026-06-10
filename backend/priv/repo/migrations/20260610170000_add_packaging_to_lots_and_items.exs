defmodule Backend.Repo.Migrations.AddPackagingToLotsAndItems do
  use Ecto.Migration

  @moduledoc """
  Per-lot packaging dimensions so the put-away recommender can do real
  volumetric + weight fit checks instead of guessing from tags. Lives
  on the lot (not the item) because the same SKU arrives in radically
  different packaging from different suppliers — a 25 kg drum vs a
  carton of 1 kg pouches.

  `items.default_packaging` carries a JSONB template — what the item
  typically arrives as. The receive form pre-fills the new lot's
  packaging from it; operator can override per-lot in one tap when
  this batch is different.

  All units chosen to be integer-safe at the storage layer:
    * lengths in millimetres (no decimals → no rounding drift)
    * weight in kg with 3 decimal places (enough for grams)
    * units_per_package + stack_factor as plain positive integers

  Mandatory enforcement happens in the schema's changeset (cleaner
  error messages for the FE) — the DB columns stay nullable so the
  one legacy lot that already exists doesn't have to be backfilled
  before the migration can apply.
  """

  def change do
    alter table(:stock_lots) do
      # Bounding box of one primary package (drum, carton, sachet).
      add :package_length_mm, :integer
      add :package_width_mm, :integer
      add :package_height_mm, :integer
      # Net weight of one primary package, in kg.
      add :package_weight_kg, :decimal, precision: 10, scale: 3
      # How many lot units (matching the lot's stock UoM) ride in one
      # package. e.g. a 25 kg drum of vitamin powder → 25 units per
      # package; a sachet of 1 g → 0.001 OR `units_per_package: 1` if
      # the lot is measured in sachets. Default 1 covers most cases.
      add :units_per_package, :integer, default: 1
      # Max safe stack height (number of packages high). 1 = don't
      # stack; 4 = stack four-high. Used to compute floor footprint vs
      # cell footprint.
      add :stack_factor, :integer, default: 1
    end

    alter table(:items) do
      # JSONB template the receive form copies into the new lot when
      # the operator picks this item. Shape mirrors the lot columns
      # above so callers don't have to translate.
      add :default_packaging, :map
    end

    # Recency lookup for the "Use last batch" suggestion — pull the
    # most recent lot of a given item to seed defaults. The existing
    # primary key index covers item_id alone but not the combination
    # we need to keyset-sort on.
    create index(:stock_lots, [:item_id, :inserted_at])
  end
end
