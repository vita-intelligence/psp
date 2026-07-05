defmodule Backend.Items.Images do
  @moduledoc """
  Boundary for per-item image attachments. Images live in `item_images`
  with the bytes stored via `Backend.Storage`. The blob path on the
  row is opaque — only the storage adapter knows how to render it
  back into a URL.

  Set-primary is an atomic swap inside a transaction so the
  `item_images_one_primary_per_item` partial unique index is never
  violated mid-flight.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.Items.{Item, ItemImage}
  alias Backend.Repo
  alias Backend.Storage

  @audit_fields ~w(blob_path caption is_primary sort_order original_filename content_type byte_size)a

  # Allowed mime types — keep tight to dodge dangerous uploads. Any
  # other mime is rejected at the controller boundary.
  @allowed_mimes ~w(image/png image/jpeg image/webp image/gif)
  # 5 MB cap per file. Product photos rarely need more; bigger uploads
  # are usually screenshots someone forgot to compress.
  @max_bytes 5 * 1024 * 1024
  # 12 images per item. Plenty for a product gallery; stops a runaway
  # client from filling the disk.
  @max_per_item 12

  def allowed_mimes, do: @allowed_mimes
  def max_bytes, do: @max_bytes
  def max_per_item, do: @max_per_item

  # ----- read ------------------------------------------------------

  def list_for_item(item_id) when is_integer(item_id) do
    Repo.all(
      from(i in ItemImage,
        where: i.item_id == ^item_id,
        order_by: [desc: i.is_primary, asc: i.sort_order, asc: i.inserted_at],
        preload: [:uploaded_by]
      )
    )
  end

  def get_for_item(item_id, image_uuid) when is_integer(item_id) and is_binary(image_uuid) do
    case Ecto.UUID.cast(image_uuid) do
      {:ok, cast} ->
        Repo.one(
          from(i in ItemImage,
            where: i.item_id == ^item_id and i.uuid == ^cast,
            preload: [:uploaded_by]
          )
        )

      :error ->
        nil
    end
  end

  def get_for_item(_item_id, _), do: nil

  # ----- mutation --------------------------------------------------

  @doc """
  Attach a new image to an item. `upload` is a `Plug.Upload` (the
  controller hands it through as-is). Validates mime + size + per-item
  cap, writes bytes via the storage adapter, then persists the row.

  Returns `{:error, :too_many}` when the cap is hit, `{:error,
  {:invalid_mime, mime}}` / `{:error, {:too_large, byte_size}}` on
  validation failure, or `{:error, changeset}` for DB errors.
  """
  def attach(%User{} = actor, %Item{} = item, %Plug.Upload{} = upload) do
    with :ok <- check_count(item.id),
         :ok <- check_mime(upload.content_type),
         {:ok, binary, byte_size} <- read_file(upload),
         :ok <- check_size(byte_size),
         :ok <- Backend.Http.UploadValidation.verify_bytes(binary, upload.content_type) do
      image_uuid = Ecto.UUID.generate()
      ext = mime_to_ext(upload.content_type)
      blob_key = "items/#{item.uuid}/#{image_uuid}#{ext}"
      now = DateTime.utc_now() |> DateTime.truncate(:second)

      with {:ok, blob_path} <- Storage.put(blob_key, binary, content_type: upload.content_type),
           # First image on an item auto-becomes primary; subsequent
           # uploads land non-primary and the user can promote them.
           is_primary = count_for_item(item.id) == 0,
           attrs = %{
             "uuid" => image_uuid,
             "item_id" => item.id,
             "blob_path" => blob_path,
             "is_primary" => is_primary,
             "sort_order" => next_sort_order(item.id),
             "original_filename" => upload.filename,
             "content_type" => upload.content_type,
             "byte_size" => byte_size,
             "uploaded_by_id" => actor.id,
             "uploaded_at" => now
           },
           {:ok, row} <- %ItemImage{} |> ItemImage.changeset(attrs) |> Repo.insert() do
        Audit.record_created(actor, "item_image", row, snapshot(row))
        {:ok, Repo.preload(row, [:uploaded_by])}
      else
        {:error, %Ecto.Changeset{} = cs} = err ->
          # Roll back the blob write so we don't leak orphans on the disk.
          Storage.delete(blob_key)
          {:error, cs |> changeset_message_or(err)}

        other ->
          Storage.delete(blob_key)
          other
      end
    end
  end

  # When the DB insert fails we get a changeset back; preserve the
  # original error tuple shape for the caller.
  defp changeset_message_or(_cs, err), do: err |> elem(1)

  @doc """
  Atomic primary-image swap. Inside one transaction: demote any
  current primary on the item, promote the target. The partial unique
  index would otherwise reject a naive "set both to primary" sequence.
  """
  def set_primary(%User{} = actor, %ItemImage{} = image) do
    Repo.transaction(fn ->
      from(i in ItemImage,
        where: i.item_id == ^image.item_id and i.is_primary == true and i.uuid != ^image.uuid
      )
      |> Repo.update_all(set: [is_primary: false, updated_at: DateTime.utc_now() |> DateTime.truncate(:second)])

      changeset = ItemImage.changeset(image, %{"is_primary" => true})

      case Repo.update(changeset) do
        {:ok, updated} ->
          Audit.record_updated(
            actor,
            "item_image",
            updated,
            snapshot(image),
            snapshot(updated)
          )

          Repo.preload(updated, [:uploaded_by])

        {:error, cs} ->
          Repo.rollback(cs)
      end
    end)
  end

  def update_metadata(%User{} = actor, %ItemImage{} = image, attrs) do
    before_state = snapshot(image)

    image
    |> ItemImage.changeset(stringify_keys(attrs))
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(
          actor,
          "item_image",
          updated,
          before_state,
          snapshot(updated)
        )

        {:ok, Repo.preload(updated, [:uploaded_by])}

      other ->
        other
    end
  end

  def delete(%User{} = actor, %ItemImage{} = image) do
    before_state = snapshot(image)

    case Repo.delete(image) do
      {:ok, deleted} ->
        # Best-effort blob cleanup. If the file is already gone the
        # adapter just no-ops.
        Storage.delete(image.blob_path)
        Audit.record_deleted(actor, "item_image", image, before_state)
        {:ok, deleted}

      other ->
        other
    end
  end

  # ----- validation helpers ---------------------------------------

  defp check_count(item_id) do
    if count_for_item(item_id) >= @max_per_item do
      {:error, :too_many}
    else
      :ok
    end
  end

  defp check_mime(mime) when is_binary(mime) do
    if mime in @allowed_mimes do
      :ok
    else
      {:error, {:invalid_mime, mime}}
    end
  end

  defp check_mime(_), do: {:error, {:invalid_mime, nil}}

  defp check_size(bytes) when is_integer(bytes) and bytes <= @max_bytes, do: :ok
  defp check_size(bytes), do: {:error, {:too_large, bytes}}

  defp read_file(%Plug.Upload{path: path}) when is_binary(path) do
    case File.read(path) do
      {:ok, binary} -> {:ok, binary, byte_size(binary)}
      {:error, reason} -> {:error, {:read_failed, reason}}
    end
  end

  defp mime_to_ext("image/png"), do: ".png"
  defp mime_to_ext("image/jpeg"), do: ".jpg"
  defp mime_to_ext("image/webp"), do: ".webp"
  defp mime_to_ext("image/gif"), do: ".gif"
  defp mime_to_ext(_), do: ""

  defp count_for_item(item_id) do
    Repo.one(from(i in ItemImage, where: i.item_id == ^item_id, select: count(i.id))) || 0
  end

  defp next_sort_order(item_id) do
    case Repo.one(from(i in ItemImage, where: i.item_id == ^item_id, select: max(i.sort_order))) do
      nil -> 0
      n -> n + 1
    end
  end

  defp snapshot(%ItemImage{} = i),
    do: Map.new(@audit_fields, fn k -> {k, Map.get(i, k)} end)

  defp stringify_keys(attrs) do
    Enum.into(attrs, %{}, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end
end
