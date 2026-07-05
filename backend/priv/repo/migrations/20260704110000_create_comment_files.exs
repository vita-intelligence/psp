defmodule Backend.Repo.Migrations.CreateCommentFiles do
  use Ecto.Migration

  @moduledoc """
  Attachment files for messenger-style comment threads.

  Shape mirrors `vendor_files` — bytes live in `Backend.Storage`, this
  row carries the metadata (filename, mime, size, uploader) plus the
  classification the FE needs to pick a render mode without sniffing
  mime.

  `kind` is the classification (image / video / audio / gif / file) so
  the frontend can decide render mode up front. Nullable dimensions +
  duration + waveform back the richer render paths (image thumbnails,
  audio waveforms, video posters) without a separate table.

  `comment_id` is `on_delete: :delete_all` — attachments follow the
  comment. Attachments outliving their parent comment don't make sense
  (a soft-deleted comment still has its row, so its files are still
  reachable; a hard-deleted comment takes its files with it).
  """

  def change do
    create table(:comment_files) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :filename, :string, size: 255, null: false
      add :mime, :string, size: 120, null: false
      add :byte_size, :bigint, null: false
      add :blob_path, :string, size: 500, null: false

      # image / video / audio / gif / file — the FE picks a render mode
      # off this without sniffing mime. Default is a plain file.
      add :kind, :string, size: 20, null: false, default: "file"

      # Image / video / gif rendering hints — nullable because they don't
      # apply to plain files and we don't want to force a probe on the
      # upload path when the client already knows the answer.
      add :width_px, :integer
      add :height_px, :integer

      # Audio / video duration in milliseconds.
      add :duration_ms, :integer

      # Base64 JSON blob for pre-rendered voice waveform peaks so the
      # bubble can paint the little bars without a second fetch.
      add :waveform, :text

      add :company_id, references(:companies, on_delete: :delete_all), null: false
      add :comment_id, references(:comments, on_delete: :delete_all), null: false
      add :uploaded_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:comment_files, [:uuid])
    create index(:comment_files, [:comment_id])
  end
end
