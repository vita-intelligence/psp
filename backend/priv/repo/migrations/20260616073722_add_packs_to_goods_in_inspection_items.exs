defmodule Backend.Repo.Migrations.AddPacksToGoodsInInspectionItems do
  use Ecto.Migration

  # Multi-pack capture on the mobile inspection wizard. One PO line can
  # arrive split across N physical packs (4×25 kg drums + 1×50 kg sack
  # = 5 packs) and each pack will materialise as its own stock_lot on
  # QC approval — same shape the manual-lot creation flow already uses.
  #
  # Stored as a JSON array of objects: each object carries qty +
  # L/W/H mm + weight_kg + units_per_package + optional
  # supplier_batch_no override. Legacy rows default to `[]` and fall
  # back to the row's `qty_received` as one implicit pack.
  def change do
    alter table(:goods_in_inspection_items) do
      add :packs, :jsonb, null: false, default: "[]"
    end
  end
end
