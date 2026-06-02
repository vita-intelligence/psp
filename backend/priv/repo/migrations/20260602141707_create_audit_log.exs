defmodule Backend.Repo.Migrations.CreateAuditLog do
  use Ecto.Migration

  @moduledoc """
  Phase B: a generic field-level change log for every audited entity.

  One row per mutation. `entity_type` is a short string like
  `"warehouse"` / `"user"` / `"template"` (kept as a string rather than
  an enum so adding a new audited entity doesn't need a schema change).
  `entity_id` is the integer PK; `entity_uuid` mirrors it for friendly
  URLs and to keep history viewable even if a row is later renumbered.

  `event` is `"created"`, `"updated"`, or `"deleted"`. For `updated`,
  `changes` is a per-field diff: `{"name": {"old": "X", "new": "Y"}}`.
  For `created` / `deleted` we store the full state under
  `{"<field>": {"old": null, "new": ...}}` (created) and the inverse
  (deleted). Keeps the reader code uniform.

  `actor_snapshot` preserves the actor's name + email at the time of
  the event so history rows stay readable after the user is renamed or
  removed.
  """

  def change do
    create table(:audit_events) do
      add :company_id, references(:companies, on_delete: :delete_all), null: false
      add :entity_type, :string, null: false, size: 32
      add :entity_id, :bigint, null: false
      add :entity_uuid, :uuid

      add :event, :string, null: false, size: 16

      add :actor_id, references(:users, on_delete: :nilify_all)
      add :actor_snapshot, :map, null: false, default: %{}
      add :changes, :map, null: false, default: %{}

      add :at, :utc_datetime_usec,
        null: false,
        default: fragment("(now() at time zone 'utc')")
    end

    create index(:audit_events, [:entity_type, :entity_id, :at])
    create index(:audit_events, [:company_id, :at])
    create index(:audit_events, [:actor_id, :at])
  end
end
