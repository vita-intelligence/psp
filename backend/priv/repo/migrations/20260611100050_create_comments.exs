defmodule Backend.Repo.Migrations.CreateComments do
  use Ecto.Migration

  @moduledoc """
  Polymorphic comment thread shared across every entity that benefits
  from a discussion timeline instead of a single-author notes textarea.

  One row per comment. `entity_type` + `entity_id` form the polymorphic
  edge — we deliberately don't carry per-entity FKs because the table
  is intentionally reused (vendor, purchase_order, stock_lot, plus
  future kinds — receipt verdicts, QC reviews, disputes). The price
  is no referential-integrity arrow at the DB layer for the comment ↔
  entity edge; we accept that for the polymorphism win.

  Visibility is scoped to "internal" for now. The "shared" branch is
  there for when we ship a portal/customer surface — keeping the
  column on day one avoids a downstream migration.

  `parent_comment_id` is populated by the context but the v1 UI is
  flat — threading is a v2 UX decision but we want the wiring on day
  one so old rows don't have to be migrated.

  Soft-delete is the convention: setting `body` to `[deleted]` and
  leaving the row intact preserves the audit trail.

  Indexes:
    * `(company_id, entity_type, entity_id, inserted_at DESC)` — the
      timeline pull. Every comment-thread render hits this exact
      shape.
    * `(company_id, entity_type, parent_comment_id)` — supports the
      eventual threaded read pattern without a sequential scan.
  """

  def change do
    create table(:comments) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      # Polymorphic edge. `entity_type` is a stable string code; ids
      # are plain bigints (matches the audit_events shape).
      add :entity_type, :string, null: false, size: 40
      add :entity_id, :bigint, null: false

      add :body, :text, null: false

      # internal (staff only) vs shared (portal/customer-visible).
      add :visibility, :string, null: false, default: "internal", size: 20

      # Self-reference for v2 threading. Nullable; v1 leaves blank.
      add :parent_comment_id, references(:comments, on_delete: :nilify_all)

      # int[] of user ids the comment @mentioned. Notification fan-out
      # is a v2 feature; populating now means we don't have to backfill.
      add :mentioned_user_ids, {:array, :bigint}, default: []

      add :edited_at, :utc_datetime

      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :author_id, references(:users, on_delete: :nilify_all), null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:comments, [:uuid])

    # The timeline pull. `inserted_at DESC` matches both the channel's
    # "newest at the top of memory" and the controller's pagination.
    create index(:comments, [:company_id, :entity_type, :entity_id, :inserted_at])

    # Threaded read (v2 — but the index ships now so we don't seq-scan
    # the day we flip the UI on).
    create index(:comments, [:parent_comment_id])
  end
end
