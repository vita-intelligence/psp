defmodule Backend.Repo.Migrations.AddCodeToWarehouses do
  use Ecto.Migration
  import Ecto.Query

  @moduledoc """
  Adds a public `code` column to every numbered entity that didn't
  have one yet — warehouses, users, roles. storage_locations already
  has one; floors / storage_cells are surfaced via their parent's
  code + ordinal so they don't need their own.

  Codes auto-generate on create from `companies.numbering_formats`
  (Backend.Numbering). Existing rows backfilled here using the same
  prefix + padding the admin already configured.
  """

  def up do
    alter table(:warehouses) do
      add :code, :string, size: 40
    end

    alter table(:users) do
      add :code, :string, size: 40
    end

    alter table(:roles) do
      add :code, :string, size: 40
    end

    flush()

    backfill_codes("warehouses", "warehouse", "WH")
    backfill_codes("users", "user", "U")
    backfill_codes("roles", "template", "PT")

    create unique_index(:warehouses, [:company_id, :code],
             name: :warehouses_company_id_code_index
           )

    create unique_index(:users, [:company_id, :code],
             name: :users_company_id_code_index
           )

    create unique_index(:roles, [:company_id, :code],
             name: :roles_company_id_code_index
           )
  end

  def down do
    drop index(:warehouses, [:company_id, :code],
           name: :warehouses_company_id_code_index
         )

    drop index(:users, [:company_id, :code],
           name: :users_company_id_code_index
         )

    drop index(:roles, [:company_id, :code],
           name: :roles_company_id_code_index
         )

    alter table(:warehouses) do
      remove :code
    end

    alter table(:users) do
      remove :code
    end

    alter table(:roles) do
      remove :code
    end
  end

  defp backfill_codes(table_name, format_key, default_prefix) do
    repo = repo()

    formats =
      repo.all(
        from(c in "companies", select: {c.id, c.numbering_formats})
      )
      |> Enum.into(%{}, fn {id, formats} -> {id, formats || %{}} end)

    # Raw SQL because Ecto's `from` macro doesn't take runtime
    # string table names. The migration runs once at deploy time so
    # the explicit interpolation is safe — table_name comes from the
    # three hardcoded strings above, not user input.
    %{rows: rows} =
      repo.query!(
        "SELECT id, company_id FROM #{table_name} ORDER BY company_id ASC, id ASC"
      )

    {assignments, _} =
      Enum.map_reduce(rows, %{}, fn [id, company_id], acc ->
        n = Map.get(acc, company_id, 0) + 1
        format = Map.get(formats, company_id, %{})
        prefix = (format[format_key] || %{})["prefix"] || default_prefix
        padding = (format[format_key] || %{})["padding"] || 5
        padded = String.pad_leading(Integer.to_string(n), padding, "0")
        {{id, "#{prefix}#{padded}"}, Map.put(acc, company_id, n)}
      end)

    Enum.each(assignments, fn {id, code} ->
      repo.query!(
        "UPDATE #{table_name} SET code = $1 WHERE id = $2",
        [code, id]
      )
    end)
  end
end
