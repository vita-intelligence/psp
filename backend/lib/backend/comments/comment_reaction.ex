defmodule Backend.Comments.CommentReaction do
  @moduledoc """
  A single emoji reaction on a comment. See
  `priv/repo/migrations/.._create_comment_reactions.exs` for the
  identity + cascade reasoning.

  There's no `update_changeset` — reactions are immutable. If a user
  changes their mind they remove the old row and add a new one.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Comments.Comment
  alias Backend.Companies.Company

  @emoji_max 32

  schema "comment_reactions" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :emoji, :string

    belongs_to :company, Company
    belongs_to :comment, Comment
    belongs_to :user, User

    timestamps(type: :utc_datetime)
  end

  def emoji_max, do: @emoji_max

  def changeset(reaction, attrs) do
    reaction
    |> cast(attrs, [:company_id, :comment_id, :user_id, :emoji])
    |> validate_required([:company_id, :comment_id, :user_id, :emoji])
    |> update_change(:emoji, fn
      nil -> nil
      e -> e |> to_string() |> String.trim()
    end)
    |> validate_length(:emoji, min: 1, max: @emoji_max)
    |> unique_constraint([:comment_id, :user_id, :emoji],
      name: :comment_reactions_comment_id_user_id_emoji_index,
      message: "already reacted"
    )
    |> foreign_key_constraint(:comment_id)
    |> foreign_key_constraint(:user_id)
    |> foreign_key_constraint(:company_id)
  end
end
