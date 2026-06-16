defmodule Backend.Repo.Migrations.AddBomEnabledToProductFamilies do
  use Ecto.Migration

  # Gate the "Create BOM" entry per product family. Admins flip this
  # on for finished-good families (e.g. "Vitamin C 30/60/90") so the
  # ops team can attach recipes; raw-material / packaging families
  # stay false. Server-side `Backend.Production.create_bom/2` enforces
  # the same rule so a forged FE call can't smuggle in a BOM against
  # a raw material.
  def change do
    alter table(:product_families) do
      add :bom_enabled, :boolean, default: false, null: false
    end
  end
end
