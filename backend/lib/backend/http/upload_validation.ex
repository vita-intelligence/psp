defmodule Backend.Http.UploadValidation do
  @moduledoc """
  Shared upload validation helpers used across every file-upload
  controller.

  The important one is `verify_bytes/2` — after the client-supplied
  MIME passes the allowlist and the bytes are read, this call sniffs
  the actual bytes and rejects when the payload doesn't match what
  the client claimed.

  Payloads whose format we cannot fingerprint (e.g. plain text, raw
  `application/octet-stream`) pass through — the allowlist has
  already gated whether that MIME is acceptable at all.
  """

  require Logger

  alias Backend.Http.MimeSniffer

  @doc """
  Confirm the first bytes of `data` match the claimed MIME.

  Returns:
    * `:ok` — bytes match, or the type isn't sniff-able
    * `{:error, :bad_mime}` — bytes are a known format that differs
      from the claim (e.g. HTML uploaded as PNG, EXE uploaded as PDF)

  Rejects always log a warning with the claim/actual mismatch so
  suspicious uploads leave a trail even when the request looks
  otherwise normal.
  """
  @spec verify_bytes(binary, String.t() | nil) ::
          :ok | {:error, {:invalid_mime, String.t()}}
  def verify_bytes(data, claimed_mime) when is_binary(data) do
    case MimeSniffer.check(data, claimed_mime) do
      :ok ->
        :ok

      :unknown ->
        :ok

      {:mismatch, sniffed} ->
        Logger.warning(
          "upload_mime_mismatch claimed=#{inspect(claimed_mime)} sniffed=#{inspect(sniffed)}"
        )

        {:error,
         {:invalid_mime,
          "File contents don't match the declared type (declared #{inspect(claimed_mime)}, looks like #{inspect(sniffed)})."}}
    end
  end
end
