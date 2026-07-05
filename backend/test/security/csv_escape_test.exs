defmodule Security.CsvEscapeTest do
  @moduledoc """
  Regression for CSV formula injection (H5).

  Excel / Google Sheets treat any cell beginning with `=`, `+`, `-`,
  `@`, a tab, or a carriage return as a formula. A vendor name like
  `=cmd|'/c calc'!A1` will execute on the importing machine. We
  guard by prefixing an apostrophe, which spreadsheets swallow and
  render as text.
  """

  use ExUnit.Case, async: true

  alias Backend.CSV.Escape

  describe "neutralise_formula/1" do
    test "leaves an ordinary string untouched" do
      assert Escape.neutralise_formula("Acme Ltd") == "Acme Ltd"
      assert Escape.neutralise_formula("100.50") == "100.50"
    end

    test "prefixes a `=` cell with a single quote" do
      assert Escape.neutralise_formula("=SUM(A1:A2)") == "'=SUM(A1:A2)"
    end

    test "handles the classic RCE payload" do
      # From payloadsallthethings — DDE / command execution vectors.
      dde = "=cmd|'/c calc'!A1"
      assert String.starts_with?(Escape.neutralise_formula(dde), "'=")
    end

    test "prefixes `+`, `-`, `@`, tab, and carriage return" do
      assert Escape.neutralise_formula("+1234") == "'+1234"
      assert Escape.neutralise_formula("-42") == "'-42"
      assert Escape.neutralise_formula("@lookup") == "'@lookup"
      assert Escape.neutralise_formula("\tHIDDEN") == "'\tHIDDEN"
      assert Escape.neutralise_formula("\rEVIL") == "'\rEVIL"
    end

    test "empty string is unchanged" do
      assert Escape.neutralise_formula("") == ""
    end
  end

  describe "escape/2 — combined RFC 4180 + formula guard" do
    test "safe cell needs no wrapping" do
      assert Escape.escape("Acme", ",") == "Acme"
    end

    test "cell containing the separator is quoted" do
      assert Escape.escape("Acme, Ltd", ",") == ~s|"Acme, Ltd"|
    end

    test "embedded quotes get doubled" do
      assert Escape.escape(~s|Acme "bulk" division|, ",") ==
               ~s|"Acme ""bulk"" division"|
    end

    test "formula-prefixed cell is neutralised AND quoted when it needs to be" do
      # `=SUM(A1,B1)` contains the sep, so it needs quotes AND the
      # apostrophe guard.
      assert Escape.escape("=SUM(A1,B1)", ",") == ~s|"'=SUM(A1,B1)"|
    end

    test "formula-prefixed cell without separator stays unquoted but still safe" do
      assert Escape.escape("=42", ",") == "'=42"
    end

    test "semicolon separator works the same" do
      assert Escape.escape("=1;=2", ";") == ~s|"'=1;=2"|
    end
  end
end
