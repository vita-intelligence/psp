defmodule Backend.Repo.Migrations.AddCodeToStorageTags do
  use Ecto.Migration
  import Ecto.Query

  @moduledoc """
  Mirrors the warehouses/users/roles code-column pattern for the
  company-scoped storage tag vocabulary. The numeric code (TA00001…)
  is the admin-facing identifier shown in lists; the existing `key`
  stays as the lowercase slug allocation joins on.
  """

  def up do
    alter table(:storage_tags) do
      add :code, :string, size: 40
    end

    flush()

    backfill_codes()

    create unique_index(:storage_tags, [:company_id, :code],
             name: :storage_tags_company_id_code_index
           )
  end

  def down do
    drop index(:storage_tags, [:company_id, :code],
           name: :storage_tags_company_id_code_index
         )

    alter table(:storage_tags) do
      remove :code
    end
  end

  defp backfill_codes do
    repo = repo()

    formats =
      repo.all(
        from(c in "companies", select: {c.id, c.numbering_formats})
      )
      |> Enum.into(%{}, fn {id, formats} -> {id, formats || %{}} end)

    %{rows: rows} =
      repo.query!(
        "SELECT id, company_id FROM storage_tags ORDER BY company_id ASC, id ASC"
      )

    {assignments, _} =
      Enum.map_reduce(rows, %{}, fn [id, company_id], acc ->
        n = Map.get(acc, company_id, 0) + 1
        format = Map.get(formats, company_id, %{})
        prefix = (format["storage_tag"] || %{})["prefix"] || "TA"
        padding = (format["storage_tag"] || %{})["padding"] || 5
        padded = String.pad_leading(Integer.to_string(n), padding, "0")
        {{id, "#{prefix}#{padded}"}, Map.put(acc, company_id, n)}
      end)

    Enum.each(assignments, fn {id, code} ->
      repo.query!("UPDATE storage_tags SET code = $1 WHERE id = $2", [code, id])
    end)
  end
end
