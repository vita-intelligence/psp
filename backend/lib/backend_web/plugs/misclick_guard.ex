defmodule BackendWeb.Plugs.MisclickGuard do
  @moduledoc """
  Plug that catches double-clicks / accidental request re-fires by
  replaying the first response for any request whose fingerprint
  arrived within the cache TTL (10s).

  Fingerprint = `sha256(actor_id | method | path | raw_body)`. See
  `Backend.MisclickGuard` for the reasoning.

  ### What it protects

  Every mutating request (POST / PUT / PATCH) on pipelines this plug
  is attached to. GETs / HEADs / OPTIONs are inherently safe and
  skipped. DELETEs are also skipped — a repeat DELETE is idempotent
  at the HTTP layer and rarely represents a misclick worth deduping
  (usually a stale FE re-fires cleanup).

  ### What it deliberately does NOT protect

  * File uploads (`multipart/form-data`) — hashing megabytes of body
    per request is wasteful, and file uploads have their own natural
    dedup (blob hash / filename).
  * Login / register / password-reset — rate-limited by
    `BackendWeb.Plugs.RateLimit` on stricter windows; a legit user
    trying again 3s after typing the wrong password is already
    handled there.
  * Requests without a resolvable actor — anonymous requests get
    fingerprinted with `anon:<ip>`, but the whole point of a
    misclick guard is per-user; leaving anon on catches
    unauthenticated public endpoints too (which is a bonus).

  ### How the response is captured + replayed

  On miss: register a `before_send` callback that snapshots the
  outgoing status + body + headers into the cache. On hit: send the
  cached snapshot directly and halt the pipeline — the controller
  never runs, no DB write, no side-effects. From the client's
  perspective the two requests are indistinguishable from one
  successful request that happened to be delivered twice.

  ### 5xx caching

  We only cache 2xx and 4xx responses. A 5xx is a server failure —
  the operator's retry is legitimate and might succeed (transient DB
  hiccup, timeout, etc.). Caching a 500 would trap the user in the
  same error for 10s.
  """

  import Plug.Conn

  @behaviour Plug

  # Methods that mutate state. Everything else passes through.
  @guarded_methods ~w(POST PUT PATCH)

  # Headers we replay from the cached response. Deliberately narrow —
  # `content-type`, request-id / audit metadata. We DON'T replay
  # `set-cookie` (would rotate the user's session cookie twice), nor
  # rate-limit headers (belong to the current request, not the cached
  # one), nor `x-request-id` (each request should have its own).
  @replayable_headers ~w(content-type location)

  @impl true
  def init(opts) do
    %{
      ttl_seconds:
        Keyword.get(opts, :ttl_seconds, Backend.MisclickGuard.default_ttl_seconds())
    }
  end

  @impl true
  def call(%Plug.Conn{method: method} = conn, opts) when method in @guarded_methods do
    if skip?(conn) do
      conn
    else
      guard(conn, opts)
    end
  end

  def call(conn, _opts), do: conn

  # ── main path ────────────────────────────────────────────────────

  defp guard(conn, %{ttl_seconds: ttl}) do
    fingerprint = fingerprint_for(conn)

    case Backend.MisclickGuard.get(fingerprint) do
      {:hit, {status, body, headers}} ->
        # Replay: another request with the exact same actor / method /
        # path / body landed within the last ``ttl`` seconds. Emit its
        # cached response so the client can't tell it's a re-fire.
        conn
        |> put_replayable_headers(headers)
        |> put_resp_header("x-misclick-guard", "replay")
        |> send_resp(status, body)
        |> halt()

      :miss ->
        # First occurrence — run the handler, then snapshot the
        # response into the cache so a follow-up misclick hits.
        conn
        |> put_resp_header("x-misclick-guard", "miss")
        |> register_before_send(fn c ->
          maybe_cache(fingerprint, c, ttl)
          c
        end)
    end
  end

  # ── skip rules ───────────────────────────────────────────────────

  # Multipart bodies (file uploads) — don't hash megabytes.
  defp skip?(conn) do
    case get_req_header(conn, "content-type") do
      [ct | _] when is_binary(ct) ->
        String.starts_with?(ct, "multipart/")

      _ ->
        false
    end
  end

  # ── fingerprint ──────────────────────────────────────────────────

  defp fingerprint_for(conn) do
    actor_id = actor_identifier(conn)
    raw_body = raw_body_for(conn)

    Backend.MisclickGuard.fingerprint(
      actor_id,
      conn.method,
      conn.request_path,
      raw_body
    )
  end

  # Prefer the authenticated user id (assigned by RequireAuth), fall
  # back to the integration token id, fall back to the client IP for
  # unauthenticated routes. All namespaced so a user id can never
  # collide with an integration token id or an IP.
  defp actor_identifier(conn) do
    cond do
      user = conn.assigns[:current_user] ->
        "u:#{user.id}"

      token = conn.assigns[:current_integration_token] ->
        "t:#{token.id}"

      true ->
        "ip:#{client_ip(conn)}"
    end
  end

  # `conn.body_params` is the parsed body — a map — which is fine for
  # hashing since equivalent maps encode to equivalent JSON. Uses
  # Jason for stable serialisation; falls back to :erlang.term_to_binary
  # for the odd shape that isn't JSON-encodable (multipart params etc).
  defp raw_body_for(conn) do
    case conn.body_params do
      %Plug.Conn.Unfetched{} ->
        ""

      %{} = params ->
        case Jason.encode(params) do
          {:ok, iodata} -> iodata
          {:error, _} -> :erlang.term_to_binary(params)
        end

      _ ->
        ""
    end
  end

  defp client_ip(conn) do
    case get_req_header(conn, "x-forwarded-for") do
      [xff | _] ->
        xff
        |> String.split(",")
        |> List.first()
        |> String.trim()

      [] ->
        conn.remote_ip |> :inet.ntoa() |> to_string()
    end
  end

  defp put_replayable_headers(conn, headers) do
    Enum.reduce(headers, conn, fn {k, v}, c ->
      if k in @replayable_headers, do: put_resp_header(c, k, v), else: c
    end)
  end

  # ── caching ──────────────────────────────────────────────────────

  # Cache 2xx + 4xx (successful writes + expected validation errors —
  # both deserve dedup so a misclicked "submit" doesn't get toasted
  # twice). Skip 5xx — those are transient failures where a retry is
  # legitimate and might succeed.
  defp maybe_cache(fingerprint, %Plug.Conn{status: status, resp_body: body, resp_headers: headers}, ttl)
       when status in 200..299 or status in 400..499 do
    snapshot_headers =
      Enum.filter(headers, fn {k, _v} -> k in @replayable_headers end)

    Backend.MisclickGuard.put(
      fingerprint,
      {status, IO.iodata_to_binary(body || ""), snapshot_headers},
      ttl
    )
  end

  defp maybe_cache(_, _, _), do: :ok
end
