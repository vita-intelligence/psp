defmodule Backend.Repo.Migrations.UnitsPerPackageDecimal do
  use Ecto.Migration

  # `units_per_package` was originally integer — fine when every item
  # was discretely countable (24 cans in a box, 100 capsules in a
  # bottle). It breaks for continuous-UoM items: a powder produced in
  # 4.4 kg bags should record `units_per_package = 4.4`, not be
  # rounded to 5 or stored as 1-with-stretched-volume-math.
  #
  # `numeric(10,3)` matches `package_weight_kg`'s precision so unit
  # arithmetic stays consistent. Existing integer values cast
  # losslessly; the default stays 1.
  def change do
    alter table(:stock_lots) do
      modify :units_per_package, :"numeric(10,3)",
        from: :integer,
        default: 1
    end
  end
end
