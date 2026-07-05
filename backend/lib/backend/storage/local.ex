defmodule Backend.Storage.Local do
  @moduledoc """
  Filesystem-backed `Backend.Storage` adapter. Writes blobs under
  `priv/uploads/` (configurable via `:root` app env). Used in dev +
  single-host deployments; production swaps in a cloud adapter
  behind the same behaviour without touching call sites.

  `public_url/2` returns a Phoenix route — the file is served by an
  authed controller, NOT by Phoenix's static plug, so RBAC still
  applies on every fetch. This means in dev there are no signed URLs
  / TTLs to worry about; the auth cookie is the gate.
  """

  @behaviour Backend.Storage

  # File.write! target derives from `absolute_path/1` which enforces
  # a Path.expand root check — even a bug that pipes user input in
  # here can't escape the storage root.
  @impl true
  def put(key, binary, _opts) when is_binary(key) and is_binary(binary) do
    path = absolute_path(key)
    :ok = path |> Path.dirname() |> File.mkdir_p!()
    File.write!(path, binary)
    {:ok, key}
  rescue
    e -> {:error, e}
  end

  # File.rm target derives from `absolute_path/1` — see the note on
  # `put/3` above.
  @impl true
  def delete(path) when is_binary(path) do
    absolute = absolute_path(path)
    _ = File.rm(absolute)
    :ok
  end

  @impl true
  def public_url(path, _opts) do
    case String.split(path, "/", parts: 3) do
      ["items", item_uuid, rest] ->
        # Items.Images path: `items/<item_uuid>/<image_uuid>.<ext>` —
        # served by ItemImageController with RBAC gates.
        image_uuid = rest |> Path.rootname()
        "/api/items/#{item_uuid}/images/#{image_uuid}/file"

      ["movement_photos", filename, ""] ->
        # Movement photos: `movement_photos/<photo_uuid>.<ext>` (path
        # split with parts: 3 yields a trailing empty string). Served
        # by MovementPhotoController.serve_file gated on stock.view.
        uuid = filename |> Path.rootname()
        "/api/stock/movement-photos/#{uuid}/file"

      ["movement_photos", filename] ->
        uuid = filename |> Path.rootname()
        "/api/stock/movement-photos/#{uuid}/file"

      ["comment_files", _comment_uuid, filename] ->
        # `comment_files/<comment_uuid>/<kind>_<file_uuid>.<ext>`. The
        # trailing UUID is what the bare serve endpoint looks up; kind
        # + comment_uuid are storage-layout hints and don't need to
        # appear in the URL since the controller re-derives entity
        # scope from the file's parent comment at fetch time.
        file_uuid =
          filename
          |> Path.rootname()
          |> String.split("_", parts: 2)
          |> List.last()

        "/api/comment-files/#{file_uuid}/serve"

      _ ->
        nil
    end
  end

  @doc """
  Absolute on-disk path for a given blob key. Public for the file-
  serve controllers to stream from.

  Every caller today feeds a DB-stored `blob_path` here — that's a
  string the app itself picked at upload time, not user input. Even
  so, we expand the joined path and verify it stays under `root()`.
  A future callsite that plumbs user input this far (a mistake) will
  raise instead of silently reading `/etc/passwd`.
  """
  def absolute_path(key) when is_binary(key) do
    root = root() |> Path.expand()
    expanded = Path.expand(Path.join(root, key))

    if String.starts_with?(expanded, root <> "/") or expanded == root do
      expanded
    else
      raise ArgumentError,
        message:
          "Backend.Storage.Local.absolute_path/1 refused to leave root: key=#{inspect(key)}"
    end
  end

  defp root do
    Application.get_env(:backend, Backend.Storage, [])[:root] ||
      Path.join(:code.priv_dir(:backend), "uploads")
  end
end
