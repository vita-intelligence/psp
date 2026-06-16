defmodule Backend.Comments.Comment do
  @moduledoc """
  One row in a polymorphic comment thread. See `Backend.Comments` for
  the boundary + `priv/repo/migrations/.._create_comments.exs` for the
  shape reasoning.

  Soft-delete convention: deleting rewrites `body` to `[deleted]` and
  preserves the row. The schema doesn't enforce that — the context
  layer does — because we want the column to be able to hold the
  marker without a separate `deleted_at` flag (the audit row carries
  the timestamp). Authorship + entity edge stay readable forever.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company

  @entity_types ~w(vendor purchase_order stock_lot purchase_order_line bom workstation_group workstation routing manufacturing_order)
  @visibilities ~w(internal shared)
  @body_max 4_000

  schema "comments" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :entity_type, :string
    field :entity_id, :integer

    field :body, :string
    field :visibility, :string, default: "internal"

    field :mentioned_user_ids, {:array, :integer}, default: []

    field :edited_at, :utc_datetime

    belongs_to :company, Company
    belongs_to :author, User
    belongs_to :parent_comment, __MODULE__

    timestamps(type: :utc_datetime)
  end

  def entity_types, do: @entity_types
  def visibilities, do: @visibilities
  def body_max, do: @body_max

  @doc """
  Create-time changeset. `body`, `entity_type`, `entity_id`,
  `company_id`, `author_id` are required; everything else has a
  sensible default.
  """
  def create_changeset(comment, attrs) do
    comment
    |> cast(attrs, [
      :entity_type,
      :entity_id,
      :body,
      :visibility,
      :mentioned_user_ids,
      :parent_comment_id,
      :company_id,
      :author_id
    ])
    |> validate_required([:entity_type, :entity_id, :body, :company_id, :author_id])
    |> validate_body()
    |> validate_inclusion(:entity_type, @entity_types,
      message: "is not a supported entity type"
    )
    |> validate_inclusion(:visibility, @visibilities)
    |> foreign_key_constraint(:author_id)
    |> foreign_key_constraint(:company_id)
    |> foreign_key_constraint(:parent_comment_id)
  end

  @doc """
  Update changeset — only the body + visibility may change. Author /
  entity edge are immutable for traceability (you can't move someone
  else's comment onto a different vendor).

  Stamps `edited_at` whenever the body actually changes so the UI can
  surface an "edited" marker. Visibility flips are silent on purpose
  — they're rare and the audit log carries the diff if needed.
  """
  def update_changeset(comment, attrs) do
    comment
    |> cast(attrs, [:body, :visibility, :mentioned_user_ids])
    |> validate_required([:body])
    |> validate_body()
    |> validate_inclusion(:visibility, @visibilities)
    |> maybe_stamp_edited_at(comment)
  end

  @doc """
  Soft-delete changeset. Rewrites `body` to the deletion marker but
  leaves authorship + entity edge intact so the audit trail stays
  readable.
  """
  def delete_changeset(comment) do
    change(comment, body: "[deleted]", edited_at: DateTime.utc_now() |> DateTime.truncate(:second))
  end

  defp validate_body(changeset) do
    changeset
    |> update_change(:body, fn
      nil -> nil
      body -> body |> to_string() |> String.trim()
    end)
    |> validate_length(:body, min: 1, max: @body_max)
  end

  defp maybe_stamp_edited_at(changeset, %__MODULE__{body: old_body}) do
    new_body = get_change(changeset, :body)

    cond do
      is_nil(new_body) -> changeset
      new_body == old_body -> changeset
      true -> put_change(changeset, :edited_at, DateTime.utc_now() |> DateTime.truncate(:second))
    end
  end
end
