defmodule Backend.Storage do
  @moduledoc """
  Behaviour for blob storage adapters. The application interacts with
  uploads through this module; the concrete adapter is configured via
  `config :backend, Backend.Storage, adapter: ...`.

  Dev / single-host deploys use `Backend.Storage.Local` (filesystem at
  `priv/uploads/`). Production swaps in an Azure / S3 adapter without
  touching call sites — same `put/3` + `delete/1` + `public_url/2`
  contract.

  A "blob path" is an opaque adapter-specific identifier (the local
  adapter uses `items/<item_uuid>/<image_uuid>.<ext>`, Azure would use
  the blob name). The DB stores the blob path; the adapter alone knows
  how to render it back into a fetch URL.
  """

  @typedoc "Opaque path stored in the DB. Local adapter uses a posix path; Azure would use the blob name."
  @type blob_path :: String.t()

  @typedoc "Optional adapter-specific opts (e.g. content_type for set-on-write)."
  @type put_opts :: keyword()

  @typedoc "URL the FE can fetch the bytes from. Local adapter returns an authed Phoenix route."
  @type url :: String.t()

  @callback put(key :: String.t(), binary(), put_opts()) ::
              {:ok, blob_path()} | {:error, term()}

  @callback delete(blob_path()) :: :ok | {:error, term()}

  @callback public_url(blob_path(), opts :: keyword()) :: url() | nil

  # ----- public API -----------------------------------------------

  @doc """
  Write bytes to the configured adapter under the given key. Returns
  the canonical blob path to persist on the row.
  """
  def put(key, binary, opts \\ []), do: adapter().put(key, binary, opts)

  @doc "Delete a blob by path. No-op if the blob is already gone."
  def delete(path), do: adapter().delete(path)

  @doc """
  Render a URL the FE can fetch the bytes from. For the local adapter
  this is an authed Phoenix route; for cloud adapters it'll be a
  short-lived signed URL.
  """
  def public_url(path, opts \\ []), do: adapter().public_url(path, opts)

  defp adapter,
    do: Application.get_env(:backend, __MODULE__, [])[:adapter] || Backend.Storage.Local
end
