defmodule Backend.Repo.Migrations.CreateWarehouses do
  use Ecto.Migration

  def change do
    create table(:warehouses) do
      add :company_id, references(:companies, on_delete: :delete_all), null: false
      add :name, :string, null: false, size: 200
      add :code, :string, size: 32
      add :address, :text
      add :notes, :text
      add :is_active, :boolean, default: true, null: false

      # All four are intentionally nullable. NULL means "inherit from
      # the parent company". A non-null value overrides the inherited
      # one. See Backend.Warehouses.effective_*/1 for the resolver.
      add :timezone, :string, size: 80
      add :working_hours, :map
      add :holidays, :map

      # Always present; same expandable shape as the company contacts
      # would have. Stored as JSONB with `items` list inside so future
      # additions (primary contact, ordering) don't need a migration.
      add :contacts, :map, default: %{"items" => []}, null: false

      # Reserved for the future warehouse plan (canvas shapes + grid).
      # Nullable — only populated once the user opens the plan editor.
      add :plan, :map

      timestamps(type: :utc_datetime)
    end

    create unique_index(:warehouses, [:company_id, :name])
    create unique_index(:warehouses, [:company_id, :code],
             where: "code IS NOT NULL"
           )
    create index(:warehouses, [:company_id])
  end
end
