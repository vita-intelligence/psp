defmodule Security.SecureHeadersTest do
  @moduledoc """
  Verifies the response security-headers plug covers every header we
  claim to set, at the values the audit calls out. Any future edit
  that softens a directive has to pass this suite.
  """

  use ExUnit.Case, async: true

  alias BackendWeb.Plugs.SecureHeaders

  test "attaches CSP, XFO, nosniff, referrer-policy, permissions-policy" do
    conn =
      Plug.Test.conn(:get, "/api/whatever")
      |> SecureHeaders.call(SecureHeaders.init([]))

    assert [csp] = Plug.Conn.get_resp_header(conn, "content-security-policy")
    assert csp =~ "default-src 'none'"
    assert csp =~ "frame-ancestors 'none'"

    assert ["nosniff"] = Plug.Conn.get_resp_header(conn, "x-content-type-options")
    assert ["DENY"] = Plug.Conn.get_resp_header(conn, "x-frame-options")

    assert ["strict-origin-when-cross-origin"] =
             Plug.Conn.get_resp_header(conn, "referrer-policy")

    assert [perms] = Plug.Conn.get_resp_header(conn, "permissions-policy")
    assert perms =~ "camera=()"
    assert perms =~ "geolocation=()"
  end

  test "attaches HSTS only when the request came in over HTTPS" do
    plain =
      Plug.Test.conn(:get, "/")
      |> SecureHeaders.call(SecureHeaders.init([]))

    assert Plug.Conn.get_resp_header(plain, "strict-transport-security") == []

    tls =
      Plug.Test.conn(:get, "/")
      |> Map.put(:scheme, :https)
      |> SecureHeaders.call(SecureHeaders.init([]))

    assert [hsts] = Plug.Conn.get_resp_header(tls, "strict-transport-security")
    assert hsts =~ "max-age=31536000"
    assert hsts =~ "includeSubDomains"
  end

  test "honours x-forwarded-proto for HSTS behind a proxy" do
    conn =
      Plug.Test.conn(:get, "/")
      |> Plug.Conn.put_req_header("x-forwarded-proto", "https")
      |> SecureHeaders.call(SecureHeaders.init([]))

    assert [_] = Plug.Conn.get_resp_header(conn, "strict-transport-security")
  end
end
