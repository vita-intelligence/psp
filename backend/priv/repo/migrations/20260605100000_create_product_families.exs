defmodule Backend.Repo.Migrations.CreateProductFamilies do
  use Ecto.Migration

  @moduledoc """
  A product family groups variants of the "same" product (e.g. Vitamin D
  30/60/90 capsules). Children are first-class items with their own
  spec sheets, BOMs, and regulatory data — the family carries the
  marketing identity. Pricing-axis variants and parametric BOMs
  intentionally NOT modelled (see project memo on regulated-CMO design).
  """

  def change do
    create table(:product_families) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies), null: false

      add :name, :string, null: false, size: 120
      add :description, :text
      add :is_active, :boolean, null: false, default: true

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:product_families, [:uuid])
    create unique_index(:product_families, [:company_id, :name])
    create index(:product_families, [:company_id, :is_active])
  end
end
