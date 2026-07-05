defmodule Security.AuthRateLimitTest do
  @moduledoc """
  End-to-end confirmation that the login endpoint returns 429 once
  the per-IP/email cap trips (C6).

  Belt + braces on top of `Security.HttpRateLimitTest`: this pins the
  actual plug wiring in `AuthController`, so if a future refactor
  drops the `plug` line, this test fails immediately.
  """

  use BackendWeb.ConnCase, async: false

  setup do
    # Isolate this test's counters from every other test by using a
    # random remote IP. The rate-limit key on `login` is
    # {:ip_and_param, "email"} + a separate :ip scope, both keyed on
    # remote address.
    conn =
      Phoenix.ConnTest.build_conn()
      |> Map.put(:remote_ip, {203, 0, 113, System.unique_integer([:positive]) |> rem(250)})

    %{conn: conn}
  end

  test "login returns 429 with retry-after after the per-(ip,email) cap", %{conn: conn} do
    # Cap is 10/minute per (ip + email). Send 12 attempts.
    payload = %{"email" => "unknown@vitamanufacture.co.uk", "password" => "wrong-pw"}

    results =
      for _ <- 1..12 do
        conn
        |> post("/api/auth/login", payload)
        |> Map.get(:status)
      end

    # First 10 attempts should hit the auth path (401 or similar
    # non-429 shape). At least one of the last two must be a 429.
    assert 429 in results, "expected at least one 429 in #{inspect(results)}"

    # The 429 body must include a retry-after hint so the client
    # can display "try again in N seconds" without guessing.
    limited_conn =
      Enum.reduce_while(1..3, conn, fn _, acc ->
        c = post(acc, "/api/auth/login", payload)
        if c.status == 429, do: {:halt, c}, else: {:cont, acc}
      end)

    if limited_conn.status == 429 do
      assert Enum.any?(get_resp_header(limited_conn, "retry-after"), &(&1 != nil))

      body = Jason.decode!(limited_conn.resp_body)
      assert body["error"]["code"] == "rate_limited"
    end
  end
end
