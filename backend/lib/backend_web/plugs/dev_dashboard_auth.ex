defmodule BackendWeb.Plugs.DevDashboardAuth do
  @moduledoc """
  Guards the `/dev/dashboard` + `/dev/mailbox` routes.

  Two layers:

    1. **Compile-time gate**: `Application.compile_env(:backend,
       :dev_routes)` controls whether the routes exist at all. Prod
       releases with `MIX_ENV=prod` don't include them.

    2. **Runtime BasicAuth** (this plug): even if the compile-time
       gate slipped through (a staging build accidentally flagged
       as dev), the routes require BasicAuth credentials fed by
       env vars. Missing env vars → hard 503 with a clear message.

  Configure via:

      DEV_DASHBOARD_USER=admin
      DEV_DASHBOARD_PASSWORD=<random-secret>

  On local dev these fall through when the vars are absent AND
  `Mix.env() == :dev` — the loopback loopback-only use case.
  """

  import Plug.Conn

  @behaviour Plug

  @impl true
  def init(opts), do: opts

  @impl true
  def call(conn, _opts) do
    user = System.get_env("DEV_DASHBOARD_USER")
    pass = System.get_env("DEV_DASHBOARD_PASSWORD")

    cond do
      is_binary(user) and is_binary(pass) and byte_size(pass) >= 12 ->
        Plug.BasicAuth.basic_auth(conn, username: user, password: pass)

      # Local dev only: if neither env var is set AND the endpoint
      # is bound to localhost, allow through. Any other case fails
      # closed. `remote_ip` for loopback is either 127.0.0.1 or ::1.
      Mix.env() == :dev and loopback?(conn) ->
        conn

      true ->
        conn
        |> put_resp_content_type("text/plain")
        |> send_resp(503, """
        Dev dashboard is disabled.

        Set DEV_DASHBOARD_USER and DEV_DASHBOARD_PASSWORD
        (password must be at least 12 characters) to enable it,
        or access from localhost while running mix phx.server.
        """)
        |> halt()
    end
  end

  defp loopback?(%Plug.Conn{remote_ip: {127, 0, 0, 1}}), do: true
  defp loopback?(%Plug.Conn{remote_ip: {0, 0, 0, 0, 0, 0, 0, 1}}), do: true
  defp loopback?(_), do: false
end
