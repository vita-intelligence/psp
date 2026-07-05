defmodule Security.UploadValidationTest do
  @moduledoc """
  End-to-end for the sniff → reject glue. The controller-facing
  contract is what matters: passing bytes whose magic doesn't match
  the claim returns `{:error, {:invalid_mime, ...}}`, matching the
  error tuple every upload controller already handles.
  """

  use ExUnit.Case, async: true

  alias Backend.Http.UploadValidation

  test "PDF bytes claiming PDF pass" do
    assert :ok = UploadValidation.verify_bytes("%PDF-1.4", "application/pdf")
  end

  test "HTML bytes claiming PNG return {:error, {:invalid_mime, _}}" do
    html = "<!DOCTYPE html><script>x</script>"

    assert {:error, {:invalid_mime, detail}} =
             UploadValidation.verify_bytes(html, "image/png")

    assert detail =~ "declared"
    assert detail =~ "image/png"
    assert detail =~ "text/html"
  end

  test "SVG bytes claiming JPEG are rejected" do
    svg = ~S|<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>|

    assert {:error, {:invalid_mime, _}} = UploadValidation.verify_bytes(svg, "image/jpeg")
  end

  test "nil claim always allows through (caller applies its own allowlist)" do
    assert :ok = UploadValidation.verify_bytes(<<"%PDF-">>, nil)
  end

  test "unknown-format text passes (caller has already whitelisted 'text/plain')" do
    assert :ok = UploadValidation.verify_bytes("just some text", "text/plain")
  end
end
