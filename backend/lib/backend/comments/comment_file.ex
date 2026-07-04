defmodule Backend.Comments.CommentFile do
  @moduledoc """
  An attachment on a comment thread. Bytes live in `Backend.Storage`;
  this row carries the metadata + classification the FE needs to pick
  a render mode (image / video / audio / gif / plain file).

  Mirrors `Backend.Vendors.VendorFile` shape with two extras:

    * `kind` — classification the FE branches on
    * dimensions / duration / waveform — nullable render hints for
      image, video, and voice-note bubbles
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Comments.Comment
  alias Backend.Companies.Company

  @kinds ~w(image video audio gif file)

  schema "comment_files" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :kind, :string, default: "file"
    field :filename, :string
    field :mime, :string
    field :byte_size, :integer
    field :blob_path, :string

    field :width_px, :integer
    field :height_px, :integer
    field :duration_ms, :integer
    field :waveform, :string

    belongs_to :company, Company
    belongs_to :comment, Comment
    belongs_to :uploaded_by, User

    timestamps(type: :utc_datetime)
  end

  def kinds, do: @kinds

  def changeset(file, attrs) do
    file
    |> cast(attrs, [
      :uuid,
      :company_id,
      :comment_id,
      :kind,
      :filename,
      :mime,
      :byte_size,
      :blob_path,
      :width_px,
      :height_px,
      :duration_ms,
      :waveform,
      :uploaded_by_id
    ])
    |> validate_required([
      :company_id,
      :comment_id,
      :kind,
      :filename,
      :mime,
      :byte_size,
      :blob_path
    ])
    |> validate_inclusion(:kind, @kinds)
    |> validate_length(:filename, max: 255)
    |> validate_length(:mime, max: 120)
    |> validate_length(:blob_path, max: 500)
    |> validate_number(:byte_size, greater_than: 0)
    |> validate_number(:width_px, greater_than: 0)
    |> validate_number(:height_px, greater_than: 0)
    |> validate_number(:duration_ms, greater_than_or_equal_to: 0)
  end
end
