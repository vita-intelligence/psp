defmodule Security.ContentDispositionTest do
  @moduledoc """
  Regression harness for `Backend.Http.ContentDisposition`.

  Every file-serve controller interpolates the filename from the DB
  into a `Content-Disposition` header. Before H4 this was raw
  interpolation — a filename containing `"\r\n` could inject headers
  (Set-Cookie forgery, redirect, XSS via reflected content-type).

  These tests hold the shared sanitiser to the compliance line so a
  future refactor can't silently reintroduce the injection.
  """

  use ExUnit.Case, async: true

  alias Backend.Http.ContentDisposition

  describe "header/2" do
    test "quotes and escapes a benign filename" do
      value = ContentDisposition.header(:inline, "invoice-123.pdf")

      assert value == ~s(inline; filename="invoice-123.pdf"; filename*=UTF-8''invoice-123.pdf)
    end

    test "strips CR/LF so header lines can't be forged" do
      # Classic response-splitting attempt: end the current header,
      # start a `Set-Cookie`, then a body.
      filename = "sneaky\r\nSet-Cookie: pwn=1\r\n\r\n<script>alert(1)</script>.pdf"

      value = ContentDisposition.header(:attachment, filename)

      refute value =~ "\r"
      refute value =~ "\n"
      refute String.contains?(value, "Set-Cookie")
    end

    test "escapes quote so an attacker can't break out of the quoted-string" do
      # `\"` embedded closes the filename="..." quoted-string in
      # naive interpolation; the sanitiser replaces it with `_` in
      # the ASCII fallback and percent-encodes in the UTF-8 pair.
      value = ContentDisposition.header(:inline, ~s|bad"; attachment; filename="stolen.pdf|)

      refute String.contains?(value, ~s(filename="bad"))
      assert value =~ "filename*=UTF-8''"
    end

    test "keeps unicode names readable via RFC 5987 filename*" do
      value = ContentDisposition.header(:attachment, "Ünïcode — spëcs.pdf")

      assert value =~ "filename*=UTF-8''"
      # The UTF-8 part is percent-encoded — assert on a sentinel byte
      # that we know maps to a %-encoded pair.
      assert value =~ "%C3%9C" or value =~ "%c3%9c"
    end

    test "empty / nil filenames fall back to a stable placeholder" do
      assert ContentDisposition.header(:inline, nil) =~ ~s(filename="download")
      assert ContentDisposition.header(:inline, "") =~ ~s(filename="download")
    end

    test "a filename made entirely of control chars neutralises but doesn't inject" do
      # Control bytes get replaced with `_` rather than stripped —
      # the filename becomes an ugly placeholder but the header
      # remains valid and unforgeable.
      value = ContentDisposition.header(:inline, "\n\r\t")

      refute value =~ "\n"
      refute value =~ "\r"
      refute value =~ "\t"
      assert value =~ ~s(filename="___")
    end

    test "path traversal in filename is neutralised via basename()" do
      value = ContentDisposition.header(:attachment, "../../../etc/passwd")

      # `Path.basename` reduces the value to `passwd` — no traversal
      # segments survive into the response header.
      refute value =~ "../"
      assert value =~ ~s(filename="passwd")
    end

    test "raises on unknown disposition atom" do
      assert_raise FunctionClauseError, fn ->
        ContentDisposition.header(:something_else, "x.pdf")
      end
    end
  end
end
