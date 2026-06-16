defmodule Backend.Repo.Migrations.CreateBomVersions do
  use Ecto.Migration

  # Append-only history of BOM changes. Every create + update writes
  # a snapshot row carrying the post-save state of the header + lines
  # (as jsonb) plus version_no, actor, and an optional human note.
  #
  # The latest row drives "Current version" on the detail page; older
  # rows offer a one-click revert (we insert a new version row whose
  # snapshot is the old state and apply it to the live BOM). Nothing
  # is ever mutated — that's the compliance contract: the BOM
  # timeline is immutable, every recipe change is traceable to a user
  # and a timestamp.
  def change do
    create table(:bom_versions) do
      add :uuid, :uuid, null: false
      # Monotonic per BOM. Allocated server-side as
      # `max(version_no) + 1` inside the same transaction that writes
      # the BOM, so concurrent saves get distinct numbers.
      add :version_no, :integer, null: false
      # Full post-save snapshot. Shape mirrors the BOM payload — name,
      # notes, is_primary, is_active, item_id + name + code (denormed
      # so reverts work even if the item is later renamed), and the
      # ordered list of lines with part identity + qty + UoM. JSON so
      # additive schema changes don't require a migration on history
      # rows.
      add :snapshot, :jsonb, null: false, default: "{}"
      # Operator-supplied note explaining the change. Empty for
      # legacy / initial-create rows.
      add :notes, :text

      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :bom_id, references(:boms, on_delete: :delete_all), null: false
      add :created_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime, updated_at: false)
    end

    create unique_index(:bom_versions, [:uuid])
    create index(:bom_versions, [:bom_id])
    create unique_index(:bom_versions, [:bom_id, :version_no],
             name: :bom_versions_bom_version_no_index
           )
  end
end
