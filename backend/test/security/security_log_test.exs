defmodule Security.SecurityLogTest do
  @moduledoc """
  Verifies the structured auth-event logger scrubs secrets before
  they hit the log pipeline. A caller-side bug that pipes a password
  or token into the metadata must never end up in the log line.
  """

  use ExUnit.Case, async: false

  import ExUnit.CaptureLog

  alias Backend.SecurityLog

  test "emits the event name in the metadata" do
    log =
      capture_log([level: :info], fn ->
        SecurityLog.record(:login_success,
          user_id: 42,
          email: "alice@vitamanufacture.co.uk",
          remote_ip: "10.0.0.1"
        )
      end)

    assert log =~ "event=login_success"
    assert log =~ "user_id=42"
    assert log =~ ~s(email="alice@vitamanufacture.co.uk")
    assert log =~ ~s(remote_ip="10.0.0.1")
  end

  test "drops forbidden secret keys silently" do
    log =
      capture_log([level: :info], fn ->
        SecurityLog.record(:login_failure,
          email: "eve@vitamanufacture.co.uk",
          password: "super-secret-value",
          current_password: "also-secret",
          token: "eyJhbGciOiJIUzI1NiJ9.stuff",
          session_token: "another-secret",
          reset_token: "reset-secret",
          reason: :invalid_credentials
        )
      end)

    # None of the forbidden keys or values may appear anywhere in
    # the log output — not the key name, not the value.
    for key <- [:password, :current_password, :token, :session_token, :reset_token] do
      refute log =~ Atom.to_string(key), "leaked #{key} key into log: #{log}"
    end

    for secret <- ["super-secret-value", "also-secret", "eyJhbGciOiJIUzI1NiJ9.stuff",
                   "another-secret", "reset-secret"] do
      refute log =~ secret, "leaked value #{inspect(secret)} into log"
    end

    # Non-secret fields still make it through — verifies the scrub
    # doesn't over-strip.
    assert log =~ "event=login_failure"
    assert log =~ "reason=:invalid_credentials"
  end

  test "logs success events at :info and failures at :warning" do
    info_log =
      capture_log([level: :info], fn ->
        SecurityLog.record(:login_success, user_id: 1)
      end)

    assert info_log =~ "[info]"

    warn_log =
      capture_log([level: :warning], fn ->
        SecurityLog.record(:login_failure, email: "e@x.co", reason: :invalid_credentials)
      end)

    assert warn_log =~ "[warning]"
  end

  describe "remote_ip/1" do
    test "prefers the leftmost x-forwarded-for hop" do
      conn =
        Plug.Test.conn(:post, "/")
        |> Plug.Conn.put_req_header("x-forwarded-for", "198.51.100.7, 10.0.0.1")

      assert SecurityLog.remote_ip(conn) == "198.51.100.7"
    end

    test "falls back to the peer IP when no proxy header" do
      conn =
        Plug.Test.conn(:post, "/")
        |> Map.put(:remote_ip, {203, 0, 113, 4})

      assert SecurityLog.remote_ip(conn) == "203.0.113.4"
    end
  end
end
