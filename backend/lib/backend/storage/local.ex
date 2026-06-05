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

  @impl true
  def put(key, binary, _opts) when is_binary(key) and is_binary(binary) do
    path = absolute_path(key)
    :ok = path |> Path.dirname() |> File.mkdir_p!()
    File.write!(path, binary)
    {:ok, key}
  rescue
    e -> {:error, e}
  end

  @impl true
  def delete(path) when is_binary(path) do
    absolute = absolute_path(path)
    _ = File.rm(absolute)
    :ok
  end

  @impl true
  def public_url(path, _opts) do
    # Items.Images sets the path to `items/<item_uuid>/<image_uuid>.<ext>`,
    # so the served URL embeds the parent item uuid + image uuid for
    # RBAC checks in the serving controller.
    case String.split(path, "/", parts: 3) do
      ["items", item_uuid, rest] ->
        # Strip extension off the image uuid segment.
        image_uuid = rest |> Path.rootname()
        "/api/items/#{item_uuid}/images/#{image_uuid}/file"

      _ ->
        nil
    end
  end

  @doc "Absolute on-disk path for a given blob key. Public for ImageController to stream from."
  def absolute_path(key) when is_binary(key) do
    Path.join(root(), key)
  end

  defp root do
    Application.get_env(:backend, Backend.Storage, [])[:root] ||
      Path.join(:code.priv_dir(:backend), "uploads")
  end
end
