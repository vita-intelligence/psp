defmodule Backend.Http.MimeSniffer do
  @moduledoc """
  Detect a file's true MIME type from its bytes and check whether the
  bytes actually match the client-supplied Content-Type.

  Upload endpoints treat the client `content_type` as truth. That is a
  well-known bypass: a browser will happily post a Content-Type of
  `image/png` for bytes that are, in fact, an HTML page with an inline
  `<script>`. Since our file-serve endpoints echo the stored MIME back
  in the response header, and images can be served `inline`, the
  attacker gets an XSS/HTML-execution vector unless we validate what
  we received.

  The signatures below are the "magic numbers" from
  https://en.wikipedia.org/wiki/List_of_file_signatures — trimmed to
  the file types this app actually accepts.
  """

  @type verdict :: :ok | {:mismatch, sniffed :: String.t()} | :unknown

  @doc """
  Return whether `bytes` look like the claimed `content_type`.

    * `:ok` — bytes match the claim
    * `{:mismatch, actual_mime}` — bytes look like something else
    * `:unknown` — we can't tell (short read, or unsupported type)

  For families we don't have a magic-byte match for (plain text,
  arbitrary octet-stream, unusual formats), we return `:unknown` and
  let the caller decide whether to accept.
  """
  @spec check(binary, String.t() | nil) :: verdict
  def check(_bytes, nil), do: :unknown

  def check(<<bytes::binary>>, claimed) do
    case detect(bytes) do
      :unknown -> :unknown
      sniffed when sniffed == claimed -> :ok
      # DOCX/XLSX/PPTX all live inside a ZIP container. Client MIME is
      # the OOXML flavour; sniff sees `application/zip`. Accept.
      "application/zip" ->
        cond do
          String.starts_with?(claimed, "application/vnd.openxmlformats-officedocument.") -> :ok
          String.starts_with?(claimed, "application/vnd.ms-") -> :ok
          true -> {:mismatch, "application/zip"}
        end

      sniffed ->
        {:mismatch, sniffed}
    end
  end

  @doc """
  Best-guess MIME type from the first bytes of the file.

  Returns `:unknown` when nothing matches — either the format isn't
  covered, or the bytes are too short.
  """
  @spec detect(binary) :: String.t() | :unknown
  # PDF
  def detect(<<"%PDF-", _::binary>>), do: "application/pdf"
  # JPEG (JFIF / EXIF / raw)
  def detect(<<0xFF, 0xD8, 0xFF, _::binary>>), do: "image/jpeg"
  # PNG
  def detect(<<0x89, "PNG\r\n", 0x1A, 0x0A, _::binary>>), do: "image/png"
  # GIF87a / GIF89a
  def detect(<<"GIF87a", _::binary>>), do: "image/gif"
  def detect(<<"GIF89a", _::binary>>), do: "image/gif"
  # WebP (RIFF <size> WEBP)
  def detect(<<"RIFF", _size::binary-size(4), "WEBP", _::binary>>), do: "image/webp"
  # SVG — starts with '<' and contains 'svg' in the first bytes.
  # We DO NOT serve SVG (script-execution risk), but detecting it lets
  # us reject an SVG uploaded as `image/png`.
  def detect(<<"<?xml", _::binary>> = b), do: xml_variant(b)
  def detect(<<"<svg", _::binary>>), do: "image/svg+xml"
  # HTML — starts with '<' and looks like markup.
  def detect(<<"<!DOCTYPE", _::binary>>), do: "text/html"
  def detect(<<"<html", _::binary>>), do: "text/html"
  def detect(<<"<HTML", _::binary>>), do: "text/html"
  # ZIP container — covers .docx / .xlsx / .pptx / raw .zip
  def detect(<<"PK", 0x03, 0x04, _::binary>>), do: "application/zip"
  def detect(<<"PK", 0x05, 0x06, _::binary>>), do: "application/zip"
  def detect(<<"PK", 0x07, 0x08, _::binary>>), do: "application/zip"
  # Legacy MS Office CFB (.doc / .xls / .ppt < 2007)
  def detect(<<0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, _::binary>>),
    do: "application/x-ole-storage"

  # Executables — never valid as an upload; reject decisively.
  def detect(<<"MZ", _::binary>>), do: "application/x-msdownload"
  def detect(<<0x7F, "ELF", _::binary>>), do: "application/x-executable"

  def detect(_), do: :unknown

  defp xml_variant(bytes) do
    head = binary_part(bytes, 0, min(byte_size(bytes), 512))

    cond do
      String.contains?(head, "<svg") or String.contains?(head, "<SVG") ->
        "image/svg+xml"

      true ->
        "application/xml"
    end
  end
end
