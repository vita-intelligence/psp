defmodule BackendWeb.Plugs.RateLimit do
  @moduledoc """
  Fixed-window rate-limit plug. Halts the connection with a 429 and
  a `retry-after` header when the caller trips the quota.

  Use in a controller's plug list — one plug call per action:

      plug BackendWeb.Plugs.RateLimit,
        scope: :login,
        limit: 5,
        window: 60,
        key: :ip
        when action == :login

  Options:

    * `:scope`  — atom identifying the counter bucket. Different
      scopes have independent quotas even for the same identifier
      (e.g. `:login` vs `:reset` for the same IP).
    * `:limit`  — max requests per window
    * `:window` — window size in seconds
    * `:key`    — how to derive the identifier:
      * `:ip`               — client's remote IP
      * `{:param, "email"}` — value of the JSON body param, lowercased
      * `{:ip_and_param, "email"}` — combined `ip|email`

  On block: returns 429, JSON body `%{error: {code: "rate_limited",
  detail: ..., retry_after_seconds: N}}`, sets the `retry-after`
  header. Downstream plugs / actions never run.
  """

  import Plug.Conn

  @behaviour Plug

  @impl true
  def init(opts) do
    scope = Keyword.fetch!(opts, :scope)
    limit = Keyword.fetch!(opts, :limit)
    window = Keyword.fetch!(opts, :window)
    key = Keyword.fetch!(opts, :key)

    %{scope: scope, limit: limit, window: window, key: key}
  end

  @impl true
  def call(conn, %{scope: scope, limit: limit, window: window, key: key_spec}) do
    identifier = identifier_for(conn, key_spec)

    case Backend.HttpRateLimit.hit(scope, identifier, limit, window) do
      {:ok, _count} ->
        conn

      {:limited, retry_after} ->
        Backend.SecurityLog.record(:rate_limited,
          scope: scope,
          identifier: identifier,
          retry_after: retry_after,
          path: conn.request_path
        )

        conn
        |> put_resp_header("retry-after", Integer.to_string(retry_after))
        |> put_status(:too_many_requests)
        |> Phoenix.Controller.json(
          BackendWeb.Errors.payload(
            "rate_limited",
            "Too many attempts. Please slow down and try again in a moment.",
            %{retry_after_seconds: retry_after}
          )
        )
        |> halt()
    end
  end

  defp identifier_for(conn, :ip), do: client_ip(conn)

  defp identifier_for(conn, {:param, param}) do
    value =
      conn.body_params
      |> Map.get(param)
      |> normalise_param()

    "#{param}:#{value}"
  end

  defp identifier_for(conn, {:ip_and_param, param}) do
    value =
      conn.body_params
      |> Map.get(param)
      |> normalise_param()

    "#{client_ip(conn)}|#{param}:#{value}"
  end

  defp normalise_param(nil), do: ""

  defp normalise_param(value) when is_binary(value),
    do: value |> String.trim() |> String.downcase()

  defp normalise_param(other), do: to_string(other)

  # Prefer the leftmost `x-forwarded-for` entry when present (deploys
  # sit behind Azure Front Door / a reverse proxy). Falls back to the
  # raw peer address.
  defp client_ip(conn) do
    case Plug.Conn.get_req_header(conn, "x-forwarded-for") do
      [xff | _] ->
        xff
        |> String.split(",")
        |> List.first()
        |> String.trim()

      [] ->
        conn.remote_ip |> :inet.ntoa() |> to_string()
    end
  end
end
