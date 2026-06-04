defmodule Backend.Repo.Migrations.CreateStorageTags do
  use Ecto.Migration
  import Ecto.Query

  def up do
    create table(:storage_tags) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies), null: false

      # Canonical machine identifier — lowercased, hyphen-separated.
      # storage_locations.tags + storage_cells.tags hold the same
      # strings; allocation joins on this column.
      add :key, :string, null: false, size: 60

      # Human-friendly label shown in the picker (e.g. "Cold zone"
      # for key=`cold-zone`).
      add :label, :string, null: false, size: 80

      add :description, :text

      # Where the tag is applicable. `both` = either a whole
      # location/zone or an individual cell can wear it.
      add :kind, :string, null: false, default: "both"

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:storage_tags, [:company_id, :key])
    create unique_index(:storage_tags, [:uuid])
    create index(:storage_tags, [:company_id, :kind])

    flush()

    # Backfill from the free-text tags already in storage_locations +
    # storage_cells so existing data keeps working after we add the
    # whitelist check. The label defaults to the key with hyphens
    # turned into spaces and title-cased on read by the frontend.
    backfill_existing_tags()
  end

  def down do
    drop table(:storage_tags)
  end

  defp backfill_existing_tags do
    # Pull (company_id, tag) pairs from both source tables, dedupe,
    # and insert. Done as raw SQL inside the migration so we don't
    # have to load the application's schemas (which may have moved
    # on by the time someone replays this migration).
    repo = repo()

    location_pairs =
      repo.all(
        from(l in "storage_locations",
          select: {l.company_id, fragment("unnest(?)", l.tags)},
          distinct: true,
          where: fragment("array_length(?, 1) > 0", l.tags)
        )
      )

    cell_pairs =
      repo.all(
        from(c in "storage_cells",
          select: {c.company_id, fragment("unnest(?)", c.tags)},
          distinct: true,
          where: fragment("array_length(?, 1) > 0", c.tags)
        )
      )

    now = DateTime.utc_now() |> DateTime.truncate(:second)

    rows =
      (location_pairs ++ cell_pairs)
      |> Enum.uniq()
      |> Enum.reject(fn {_, key} -> is_nil(key) or key == "" end)
      |> Enum.map(fn {company_id, key} ->
        %{
          company_id: company_id,
          key: key,
          label: key |> String.replace("-", " ") |> String.capitalize(),
          kind: "both",
          inserted_at: now,
          updated_at: now
        }
      end)

    if rows != [] do
      repo.insert_all("storage_tags", rows, on_conflict: :nothing)
    end
  end
end
