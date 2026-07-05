defmodule Security.MimeSnifferTest do
  @moduledoc """
  Ensure the magic-byte sniffer catches the file types uploads
  actually try to smuggle: a browser will trust the client-supplied
  Content-Type, and PSP echoes that back on `serve_file`. Without
  the sniff, a `.pdf` upload whose bytes are actually HTML renders
  inline and executes.
  """

  use ExUnit.Case, async: true

  alias Backend.Http.MimeSniffer

  describe "detect/1 — legitimate formats" do
    test "PDF" do
      assert MimeSniffer.detect(<<"%PDF-1.7", 0>>) == "application/pdf"
    end

    test "JPEG" do
      assert MimeSniffer.detect(<<0xFF, 0xD8, 0xFF, 0xE0, "JFIF">>) == "image/jpeg"
    end

    test "PNG" do
      png_header = <<0x89, "PNG", "\r\n", 0x1A, 0x0A, 0, 0, 0, 13>>
      assert MimeSniffer.detect(png_header) == "image/png"
    end

    test "GIF87a and GIF89a" do
      assert MimeSniffer.detect(<<"GIF87a", 0>>) == "image/gif"
      assert MimeSniffer.detect(<<"GIF89a", 0>>) == "image/gif"
    end

    test "WebP" do
      webp = <<"RIFF", 0::32, "WEBP", "VP8">>
      assert MimeSniffer.detect(webp) == "image/webp"
    end

    test "ZIP container (DOCX / XLSX / plain zip)" do
      assert MimeSniffer.detect(<<"PK", 0x03, 0x04, 0>>) == "application/zip"
    end

    test "legacy MS Office CFB (.doc / .xls / .ppt)" do
      cfb = <<0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0>>
      assert MimeSniffer.detect(cfb) == "application/x-ole-storage"
    end
  end

  describe "detect/1 — dangerous formats we reject" do
    test "SVG" do
      assert MimeSniffer.detect(<<"<svg xmlns=", ?">>) == "image/svg+xml"
    end

    test "SVG hidden in an <?xml prologue" do
      body = "<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\">"
      assert MimeSniffer.detect(body) == "image/svg+xml"
    end

    test "HTML by DOCTYPE" do
      assert MimeSniffer.detect(<<"<!DOCTYPE html><html>">>) == "text/html"
    end

    test "HTML by <html> tag" do
      assert MimeSniffer.detect(<<"<html><head>">>) == "text/html"
    end

    test "Windows PE executable (.exe / .dll)" do
      assert MimeSniffer.detect(<<"MZ", 0x90, 0>>) == "application/x-msdownload"
    end

    test "ELF executable (Linux binary)" do
      assert MimeSniffer.detect(<<0x7F, "ELF", 2, 1>>) == "application/x-executable"
    end
  end

  describe "detect/1 — unrecognised" do
    test "plain text returns :unknown" do
      assert MimeSniffer.detect("This is just a text file.") == :unknown
    end

    test "empty binary returns :unknown" do
      assert MimeSniffer.detect(<<>>) == :unknown
    end
  end

  describe "check/2 — the actual upload gate" do
    test "matching claim + bytes passes" do
      assert MimeSniffer.check(<<"%PDF-1.4">>, "application/pdf") == :ok
    end

    test "HTML uploaded as PNG is caught" do
      html = "<!DOCTYPE html><script>steal()</script>"
      assert MimeSniffer.check(html, "image/png") == {:mismatch, "text/html"}
    end

    test "SVG uploaded as PNG is caught (XSS-via-image vector)" do
      svg = ~S|<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>|
      assert MimeSniffer.check(svg, "image/png") == {:mismatch, "image/svg+xml"}
    end

    test "EXE uploaded as PDF is caught" do
      exe = <<"MZ", 0x90, 0, 0, 0>>
      assert MimeSniffer.check(exe, "application/pdf") == {:mismatch, "application/x-msdownload"}
    end

    test "DOCX (zip container) uploaded as its declared OOXML MIME passes" do
      docx_bytes = <<"PK", 0x03, 0x04, 0>>
      docx_mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

      assert MimeSniffer.check(docx_bytes, docx_mime) == :ok
    end

    test "plain text upload is :unknown (caller decides via allowlist)" do
      assert MimeSniffer.check("hello world", "text/plain") == :unknown
    end

    test "nil claim short-circuits to :unknown" do
      assert MimeSniffer.check(<<"%PDF-">>, nil) == :unknown
    end
  end
end
