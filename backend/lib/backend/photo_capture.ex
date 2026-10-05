defmodule Backend.PhotoCapture do
  @moduledoc """
  Runtime toggle for the mandatory photo-capture gates.

  Prod enforces a photo on every closeout movement, every return-
  pickup lot pick, and every outbound shipment pickup (BRCGS 3.5.1 /
  FSSC 22000 traceability — the regulator wants a visual record of
  every physical movement at the operator's station).

  Sandbox can disable the gate via the ``ENFORCE_PHOTO_CAPTURE``
  env var (``"0"`` / ``"false"`` / ``"no"`` / ``"off"`` all disable)
  so a single operator can walk a formulation end-to-end from one
  seat without staging real photos at every step. Production never
  sets the var; the default stays strict and the audit trail stays
  regulator-ready.

  The FE's ``DevSkipPhotoButton`` stamps a sentinel URL
  (``dev-skip:<iso>``) that satisfies the "non-empty binary"
  check in the gate itself, so even with enforcement ON a sandbox
  tester can skip-click; the server toggle is for direct-API /
  automated-test paths that don't go through that button.
  """

  @doc "True when the photo-capture gate should be enforced (default)."
  def enforce? do
    case System.get_env("ENFORCE_PHOTO_CAPTURE") do
      v when v in ["0", "false", "no", "off"] -> false
      _ -> true
    end
  end
end
