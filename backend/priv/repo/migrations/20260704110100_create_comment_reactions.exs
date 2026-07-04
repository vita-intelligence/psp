defmodule Backend.Repo.Migrations.CreateCommentReactions do
  use Ecto.Migration

  @moduledoc """
  Emoji reactions on comments — messenger-style tap-to-react.

  Ephemeral by design: `(comment_id, user_id, emoji)` is the primary
  identity, so a user tapping the same emoji twice is a no-op (the
  unique index rejects the duplicate at the DB layer). Reactions are
  intentionally NOT audited — they're too high-volume + low-signal for
  the audit log, which is reserved for artifact-defensibility events.

  Both FKs cascade delete: if the comment is hard-deleted the reactions
  go with it, and if the user is deleted their reactions are removed
  (an orphan `%{user_id: nil}` reaction is meaningless).
  """

  def change do
    create table(:comment_reactions) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      # Unicode emoji chars. 32 chars is enough for any ZWJ sequence a
      # picker realistically emits (👨‍👩‍👧‍👦 etc.).
      add :emoji, :string, size: 32, null: false

      add :comment_id, references(:comments, on_delete: :delete_all), null: false
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :company_id, references(:companies, on_delete: :delete_all), null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:comment_reactions, [:uuid])

    # Prevents duplicate reactions — same user, same emoji, same comment.
    # The context relies on this constraint to make `add_reaction/3`
    # idempotent (returns `{:ok, ...}` even if the row already exists).
    create unique_index(:comment_reactions, [:comment_id, :user_id, :emoji])

    # The read pattern is "give me all reactions for this comment" —
    # preloaded when we render the timeline. Individual reactions are
    # never fetched by uuid.
    create index(:comment_reactions, [:comment_id])
  end
end
