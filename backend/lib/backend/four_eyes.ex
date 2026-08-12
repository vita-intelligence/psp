defmodule Backend.FourEyes do
  @moduledoc """
  Runtime toggle for segregation-of-duties ("4-eyes") gates.

  Prod / test enforce the rule (approver ≠ preparer / qualifier /
  creator) across every gated flow: MO approve, CO director sign,
  PO director sign, vendor approve, customer approve.

  Dev flips ``config :backend, :enforce_four_eyes, false`` in
  ``config/dev.exs`` so a single developer can walk each lifecycle
  end-to-end from one seat without seeding a second user. The
  toggle exists ONLY to unblock local testing — never wire this
  key into ``runtime.exs`` or any release config.
  """

  @doc "True when the 4-eyes gate should be enforced (default)."
  def enforce?, do: Application.get_env(:backend, :enforce_four_eyes, true)
end
