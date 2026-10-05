defmodule Backend.FourEyes do
  @moduledoc """
  Runtime toggle for segregation-of-duties ("4-eyes") gates.

  Prod / test enforce the rule (approver ≠ preparer / qualifier /
  creator) across every gated flow: MO approve, CO director sign,
  PO director sign, vendor approve, customer approve.

  Dev flips ``config :backend, :enforce_four_eyes, false`` in
  ``config/dev.exs`` so a single developer can walk each lifecycle
  end-to-end from one seat without seeding a second user. The
  sandbox release honours the same intent via the
  ``ENFORCE_FOUR_EYES`` env var (``"0"`` / ``"false"`` disables)
  so a single operator can click a formulation through its full
  lifecycle without seeding a second user on PSP. Production never
  sets the var; the default stays strict.
  """

  @doc "True when the 4-eyes gate should be enforced (default)."
  def enforce? do
    case System.get_env("ENFORCE_FOUR_EYES") do
      v when v in ["0", "false", "no", "off"] -> false
      _ -> Application.get_env(:backend, :enforce_four_eyes, true)
    end
  end
end
