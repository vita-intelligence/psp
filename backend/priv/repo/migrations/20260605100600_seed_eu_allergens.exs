defmodule Backend.Repo.Migrations.SeedEuAllergens do
  use Ecto.Migration

  @moduledoc """
  Seed the EU 1169/2011 Annex II "Big 14" declared allergens. Read-only
  reference data; runs once. Idempotent via on_conflict on the unique
  `key` column.
  """

  @rows [
    {"cereals_with_gluten",
     "Cereals containing gluten (wheat, rye, barley, oats, spelt, kamut)", 10},
    {"crustaceans", "Crustaceans", 20},
    {"eggs", "Eggs", 30},
    {"fish", "Fish", 40},
    {"peanuts", "Peanuts", 50},
    {"soybeans", "Soybeans", 60},
    {"milk", "Milk (including lactose)", 70},
    {"nuts",
     "Nuts (almonds, hazelnuts, walnuts, cashews, pecans, brazil, pistachio, macadamia, queensland)",
     80},
    {"celery", "Celery", 90},
    {"mustard", "Mustard", 100},
    {"sesame", "Sesame seeds", 110},
    {"sulphur_dioxide_and_sulphites",
     "Sulphur dioxide and sulphites (above 10 mg/kg)", 120},
    {"lupin", "Lupin", 130},
    {"molluscs", "Molluscs", 140}
  ]

  def up do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    rows =
      Enum.map(@rows, fn {key, label, sort_order} ->
        %{
          uuid: Ecto.UUID.bingenerate(),
          key: key,
          label: label,
          source: "eu_1169_2011_annex_ii",
          sort_order: sort_order,
          inserted_at: now,
          updated_at: now
        }
      end)

    repo().insert_all("allergens", rows,
      on_conflict: :nothing,
      conflict_target: [:key]
    )
  end

  def down do
    keys = Enum.map(@rows, &elem(&1, 0))
    import Ecto.Query
    repo().delete_all(from(a in "allergens", where: a.key in ^keys))
  end
end
