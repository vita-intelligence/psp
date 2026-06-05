defmodule Backend.Items.ItemImage do
  @moduledoc """
  One image attached to an item. Storage is Azure blob; this row
  carries the path. The payload shaper renders a 1h SAS-signed URL
  each time the row goes over the wire — never persist a URL with
  embedded auth.

  Exactly one image per item is `is_primary` — enforced by a partial
  unique index. The context's `set_primary` swap clears the old one
  in the same transaction.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Items.Item

  schema "item_images" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :blob_path, :string
    field :caption, :string
    field :is_primary, :boolean, default: false
    field :sort_order, :integer, default: 0
    field :original_filename, :string
    field :content_type, :string
    field :byte_size, :integer
    field :uploaded_at, :utc_datetime

    belongs_to :item, Item
    belongs_to :uploaded_by, User

    timestamps(type: :utc_datetime)
  end

  def changeset(image, attrs) do
    image
    |> cast(attrs, [
      :uuid,
      :item_id,
      :blob_path,
      :caption,
      :is_primary,
      :sort_order,
      :original_filename,
      :content_type,
      :byte_size,
      :uploaded_by_id,
      :uploaded_at
    ])
    |> validate_required([:item_id, :blob_path, :uploaded_at])
    |> validate_length(:blob_path, max: 500)
    |> validate_length(:caption, max: 200)
    |> validate_length(:original_filename, max: 200)
    |> validate_length(:content_type, max: 80)
    |> validate_number(:byte_size, greater_than_or_equal_to: 0)
    |> unique_constraint([:item_id],
      name: :item_images_one_primary_per_item,
      message: "only one primary image allowed per item"
    )
  end
end
