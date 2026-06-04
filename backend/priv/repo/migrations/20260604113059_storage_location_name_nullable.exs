defmodule Backend.Repo.Migrations.StorageLocationNameNullable do
  use Ecto.Migration

  def up do
    # `name` was required at insert time when the UI had a Name input;
    # now the operator identifies locations by `code` only and the
    # Name field is gone, so the column needs to accept null /
    # empty values that Ecto.Changeset.cast/3 normalises to nil.
    alter table(:storage_locations) do
      modify :name, :string, size: 120, null: true
    end
  end

  def down do
    # Reversing this would fail if any rows are currently null —
    # leave irreversible to keep the migration safe to roll back
    # selectively.
    alter table(:storage_locations) do
      modify :name, :string, size: 120, null: false
    end
  end
end
