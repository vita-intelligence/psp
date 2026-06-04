defmodule Backend.Repo.Migrations.DropCodeColumns do
  use Ecto.Migration

  @moduledoc """
  Drops the stored `code` column from warehouses, users, roles and
  storage_tags. We now render the display code on the fly in payloads
  (`prefix + lpad(id, padding, "0")`), so prefix/padding changes are
  instantaneous (single JSONB write) and we keep zero denormalised
  state. storage_locations keeps its own `code` column — it predates
  this system and has realtime-sync code tied to the stored value.
  """

  def up do
    drop_if_exists index(:warehouses, [:company_id, :code],
                     name: :warehouses_company_id_code_index
                   )

    drop_if_exists index(:users, [:company_id, :code],
                     name: :users_company_id_code_index
                   )

    drop_if_exists index(:roles, [:company_id, :code],
                     name: :roles_company_id_code_index
                   )

    drop_if_exists index(:storage_tags, [:company_id, :code],
                     name: :storage_tags_company_id_code_index
                   )

    alter table(:warehouses), do: remove(:code)
    alter table(:users), do: remove(:code)
    alter table(:roles), do: remove(:code)
    alter table(:storage_tags), do: remove(:code)
  end

  def down do
    alter table(:warehouses), do: add(:code, :string, size: 40)
    alter table(:users), do: add(:code, :string, size: 40)
    alter table(:roles), do: add(:code, :string, size: 40)
    alter table(:storage_tags), do: add(:code, :string, size: 40)

    create unique_index(:warehouses, [:company_id, :code],
             name: :warehouses_company_id_code_index
           )

    create unique_index(:users, [:company_id, :code],
             name: :users_company_id_code_index
           )

    create unique_index(:roles, [:company_id, :code],
             name: :roles_company_id_code_index
           )

    create unique_index(:storage_tags, [:company_id, :code],
             name: :storage_tags_company_id_code_index
           )
  end
end
