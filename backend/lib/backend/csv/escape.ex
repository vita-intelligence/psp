defmodule Backend.CSV.Escape do
  @moduledoc """
  Shared CSV cell escaping helpers.

  Two concerns:

    * **RFC 4180 quoting** — cells containing the separator, a quote,
      or a newline must be wrapped in double-quotes with embedded
      quotes doubled.
    * **Formula neutralisation** — cells starting with `=`, `+`, `-`,
      `@`, tab, or carriage return are treated as formulas by Excel
      and Google Sheets on import. Prefixing with a single quote
      renders them as text and avoids arbitrary command execution
      via a vendor / customer name field.

  See `documents.ex` for the historical call site — kept public here
  so the security regression tests can drive it directly and so any
  future exporter picks the same rule.
  """

  @doc """
  Escape one CSV cell using `sep` as the field separator.

  Applies formula neutralisation first, then RFC 4180 quoting.
  """
  def escape(value, sep) do
    s =
      value
      |> to_string()
      |> neutralise_formula()

    if String.contains?(s, [sep, "\"", "\n", "\r"]) do
      "\"" <> String.replace(s, "\"", "\"\"") <> "\""
    else
      s
    end
  end

  @doc """
  Prefix a cell whose first byte would trigger a spreadsheet
  formula engine (`= + - @ \\t \\r`) with a single quote. Returns the
  string unchanged when it's safe.
  """
  def neutralise_formula(""), do: ""

  def neutralise_formula(<<c::utf8, _::binary>> = s)
      when c in [?=, ?+, ?-, ?@, ?\t, ?\r] do
    "'" <> s
  end

  def neutralise_formula(s), do: s
end
