defmodule Backend.SecurityLog do
  @moduledoc """
  Structured logging for security-sensitive events.

  Every entry is a single `Logger` call with `event: :<name>` in the
  metadata, so a log aggregator (Log Analytics, Datadog, Loki) can
  drive alerts on the event name without regexing the message text.

  Why not persist to a table? Two reasons:

    * Log aggregators are the right store for high-cardinality,
      append-only auth events — they retain, index, and forward
      alerts natively. Persisting in Postgres would duplicate that
      job and add retention pressure.
    * A failed login often lacks a company_id (unknown email,
      unconfirmed user, deactivated account). The main
      `Backend.Audit` boundary requires one, so it's the wrong home
      for auth events.

  If prod later needs SQL for compliance queries, add a
  `security_events` table and a second sink here — the callers
  don't change.
  """

  require Logger

  @type event_name ::
          :login_success
          | :login_failure
          | :login_unconfirmed
          | :login_mfa_required
          | :register_success
          | :register_failure
          | :password_changed
          | :password_reset_requested
          | :password_reset_completed
          | :password_reset_token_invalid
          | :token_verify_failure
          | :confirmation_success
          | :confirmation_failure
          | :rate_limited
          | :sessions_revoked
          | :mfa_enrolled
          | :mfa_disabled
          | :mfa_verify_success
          | :mfa_verify_failure
          | :mfa_policy_changed

  @doc """
  Record a security event.

  `metadata` is a keyword list. Reserved keys we consistently emit:

    * `:user_id`       — integer PK (when known)
    * `:email`         — lowercased email (never a password)
    * `:remote_ip`     — client's IP string (from proxy header or peer)
    * `:reason`        — atom describing the failure mode
    * `:scope`         — atom identifying the rate-limit bucket

  Other keys pass through unchanged. Never log the password, current
  or reset token, or session token — even redacted.
  """
  @spec record(event_name, keyword) :: :ok
  def record(event, metadata \\ []) when is_atom(event) and is_list(metadata) do
    scrubbed = drop_forbidden(metadata)
    context = Keyword.put(scrubbed, :event, event)

    level =
      case event do
        e when e in [:login_success, :register_success, :password_reset_requested, :confirmation_success] -> :info
        e when e in [:password_changed, :password_reset_completed, :sessions_revoked] -> :info
        _ -> :warning
      end

    Logger.log(level, fn -> format_message(event, scrubbed) end, context)
    :ok
  end

  # --- helpers -----------------------------------------------------

  # Human-readable one-liner alongside the structured metadata. Kept
  # short so tailing the raw log is still useful.
  defp format_message(event, metadata) do
    parts =
      metadata
      |> Enum.reject(fn {_k, v} -> is_nil(v) end)
      |> Enum.map(fn {k, v} -> "#{k}=#{inspect(v)}" end)
      |> Enum.join(" ")

    "security event=#{event} #{parts}"
  end

  # A defensive filter — password / token values would be caller
  # error, but if one slips in, drop it before the message hits the
  # log pipeline.
  @forbidden [:password, :current_password, :token, :session_token, :reset_token]

  defp drop_forbidden(kw), do: Keyword.drop(kw, @forbidden)

  @doc """
  Best-effort caller-side helper for extracting the client IP from a
  `Plug.Conn`. Kept here so every controller call site formats it
  the same way.
  """
  @spec remote_ip(Plug.Conn.t()) :: String.t()
  def remote_ip(%Plug.Conn{} = conn) do
    case Plug.Conn.get_req_header(conn, "x-forwarded-for") do
      [xff | _] ->
        xff
        |> String.split(",")
        |> List.first()
        |> String.trim()

      [] ->
        case conn.remote_ip do
          nil -> "unknown"
          ip -> ip |> :inet.ntoa() |> to_string()
        end
    end
  end
end
