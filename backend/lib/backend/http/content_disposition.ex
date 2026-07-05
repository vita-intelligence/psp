defmodule Backend.Http.ContentDisposition do
  @moduledoc """
  Safe `Content-Disposition` header construction.

  Filenames come from user-supplied uploads that ended up in the DB
  (`file.filename`). Interpolating them raw into a header lets an
  attacker inject additional headers via `\r\n`, break out of the
  quoted-string with `"`, or supply control bytes that browsers may
  interpret unpredictably.

  This module produces RFC 6266 + RFC 5987 compliant values:

    * ASCII fallback in `filename="..."` — quotes/backslashes escaped,
      control chars replaced with `_`
    * UTF-8 `filename*=UTF-8''<pct-encoded>` for characters outside
      US-ASCII, so browsers render the true name where they can

  Empty / nil filenames fall back to a generic placeholder so we
  never emit `filename=""`.
  """

  @doc """
  Build a Content-Disposition header value.

  `disposition` is `:inline` or `:attachment`. `filename` is the
  user-facing name (may contain any characters).

      iex> header(:attachment, "invoice #42\\r\\n.pdf")
      "attachment; filename=\\"invoice _42__.pdf\\"; filename*=UTF-8''invoice%20%2342%0D%0A.pdf"
  """
  def header(disposition, filename)
      when disposition in [:inline, :attachment] do
    safe = safe_filename(filename)

    ascii = ascii_fallback(safe)
    utf8 = URI.encode(safe, &URI.char_unreserved?/1)

    "#{disposition}; filename=\"#{ascii}\"; filename*=UTF-8''#{utf8}"
  end

  defp safe_filename(nil), do: "download"
  defp safe_filename(""), do: "download"

  defp safe_filename(name) when is_binary(name) do
    # Drop directory components — the DB may have stored a bare name
    # but old rows / imports could still carry a path.
    name
    |> Path.basename()
    |> String.replace(~r/[\x00-\x1f\x7f]/, "_")
    |> String.trim()
    |> case do
      "" -> "download"
      cleaned -> cleaned
    end
  end

  # ASCII-only quoted-string form. Non-ASCII bytes collapse to `_`
  # so the token stays a legal quoted-string; browsers pick up the
  # UTF-8 `filename*=` alongside for the real display name.
  defp ascii_fallback(name) do
    name
    |> String.replace("\\", "_")
    |> String.replace("\"", "_")
    |> String.replace(~r/[^\x20-\x7e]/, "_")
  end
end
