defmodule Backend.Repo.Migrations.DropBomEnabledFromProductFamilies do
  use Ecto.Migration

  # `product_family.bom_enabled` ended up redundant — `item.item_type`
  # already says whether something can carry a recipe. The gate now
  # lives in `Backend.Production.ensure_bommable_item_type/1`:
  #
  #   * `finished_product` → can own a BOM (default destination)
  #   * `semi_finished`   → can own a BOM (multi-stage manufacturing)
  #   * `raw_material`    → never (it's an input)
  #   * `packaging`       → never (it's an input)
  #
  # No per-family flag needed; the type drives both the BOM gate and
  # the compliance subforms in one place.
  def change do
    alter table(:product_families) do
      remove :bom_enabled, :boolean, default: false, null: false
    end
  end
end
