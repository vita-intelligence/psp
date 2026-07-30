defmodule Backend.Repo.Migrations.OneReactionPerUserPerComment do
  use Ecto.Migration

  @moduledoc """
  Shift the reaction identity from ``(comment_id, user_id, emoji)`` to
  ``(comment_id, user_id)`` — one reaction per user per comment.

  Slack / iMessage-style semantics: a user picks ONE emoji per message.
  Tapping a second emoji replaces the first. Tapping the same emoji
  again removes it. The FE quick-react bar shows the current pick as
  the highlighted state so the user always sees which emoji they've
  committed to.

  Data-migration: pre-existing users with multiple reactions on the
  same comment keep their most-recent pick — the older rows are
  deleted so the new unique index can be created cleanly.
  """

  def up do
    # Keep the newest reaction per (comment_id, user_id) tuple.
    execute("""
    DELETE FROM comment_reactions r1
    USING comment_reactions r2
    WHERE r1.comment_id = r2.comment_id
      AND r1.user_id = r2.user_id
      AND (r1.inserted_at < r2.inserted_at
           OR (r1.inserted_at = r2.inserted_at AND r1.id < r2.id))
    """)

    drop index(:comment_reactions, [:comment_id, :user_id, :emoji])
    create unique_index(:comment_reactions, [:comment_id, :user_id])
  end

  def down do
    drop index(:comment_reactions, [:comment_id, :user_id])
    create unique_index(:comment_reactions, [:comment_id, :user_id, :emoji])
  end
end
