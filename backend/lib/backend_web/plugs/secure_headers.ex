defmodule BackendWeb.Plugs.SecureHeaders do
  @moduledoc """
  Application-wide response security headers.

  Applied through the `:api` and `:api_authed` pipelines so every JSON
  response — including file-serve endpoints that stream binary bytes —
  carries the same baseline hardening:

    * `x-content-type-options: nosniff` — browsers must respect the
      declared Content-Type on file downloads. Without it, a `.pdf`
      whose bytes are actually HTML can execute inline.
    * `x-frame-options: DENY` — no framing anywhere. The app has no
      embed use case; this defence-in-depth against click-jacking.
    * `referrer-policy: strict-origin-when-cross-origin` — protects
      internal URLs from leaking to third-party analytics linked from
      external content.
    * `permissions-policy: ...` — turn off browser powerful features
      the app doesn't use.
    * `strict-transport-security` — one year, includeSubDomains. Only
      set when the request came in over HTTPS (either directly or via
      `x-forwarded-proto`, honoured by `Plug.SSL`). Skipping HSTS on
      plain HTTP responses avoids infinite-cache traps during local
      dev.

  Not a CSP — the API is JSON-only, so CSP would only apply to the
  small handful of HTML pages served by Phoenix (dev dashboard,
  mailbox preview) which live under `/dev` and are gated behind
  authentication.
  """

  import Plug.Conn

  @behaviour Plug

  @headers [
    {"x-content-type-options", "nosniff"},
    {"x-frame-options", "DENY"},
    {"referrer-policy", "strict-origin-when-cross-origin"},
    {"permissions-policy",
     "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"}
  ]

  @hsts_value "max-age=31536000; includeSubDomains"

  @impl true
  def init(opts), do: opts

  @impl true
  def call(conn, _opts) do
    conn = Enum.reduce(@headers, conn, fn {k, v}, acc -> put_resp_header(acc, k, v) end)

    if https?(conn) do
      put_resp_header(conn, "strict-transport-security", @hsts_value)
    else
      conn
    end
  end

  defp https?(%Plug.Conn{scheme: :https}), do: true

  defp https?(conn) do
    case get_req_header(conn, "x-forwarded-proto") do
      ["https" | _] -> true
      _ -> false
    end
  end
end
