defmodule Backend.HttpRateLimit do
  @moduledoc """
  Lightweight fixed-window rate limiter for HTTP endpoints.

  Backed by a single named ETS table so counters survive across
  requests without a GenServer bottleneck. We accept small races on
  the increment side (two concurrent requests may both see the same
  count) because the numbers involved for auth endpoints are so low
  that ±1 doesn't matter — the goal is to make credential-stuffing
  economically miserable, not to enforce an exact quota.

  Windows are fixed, not sliding: at second `t`, the current window is
  `div(t, window)`. When the window rolls, the counter resets. That
  can allow up to `2 * limit` requests around a window boundary, but
  the simple math beats the complexity cost of a leaky bucket for
  the volumes we care about here.

  Cleanup: entries are self-expiring in the sense that they get
  overwritten when the same key hits in a new window. A periodic
  purge job could evict old rows, but for auth endpoints the key
  space is bounded (IPs / emails from your own users) and never
  large enough for the leak to matter.
  """

  @table :backend_http_rate_limit

  @doc """
  Create the ETS table. Called at application boot.
  """
  def init do
    :ets.new(@table, [
      :named_table,
      :public,
      :set,
      read_concurrency: true,
      write_concurrency: true
    ])

    :ok
  end

  @doc """
  Charge one hit for `{scope, identifier}`. `limit` requests are
  allowed per `window_seconds` window (fixed-window count-per-second).

  Returns:
    * `{:ok, count}` — request may proceed; `count` is the new count
    * `{:limited, retry_after}` — over quota; `retry_after` is
      seconds until the next window begins
  """
  @spec hit(atom, String.t(), non_neg_integer, non_neg_integer) ::
          {:ok, non_neg_integer} | {:limited, non_neg_integer}
  def hit(scope, identifier, limit, window_seconds)
      when is_atom(scope) and is_binary(identifier) do
    ensure_table!()

    now = System.system_time(:second)
    window = div(now, window_seconds)
    key = {scope, identifier, window}

    count = :ets.update_counter(@table, key, {2, 1}, {key, 0})

    if count > limit do
      retry_after = window_seconds - rem(now, window_seconds)
      {:limited, retry_after}
    else
      {:ok, count}
    end
  end

  # If the table isn't there yet (release start-up race, or a
  # test that starts pieces of the app manually), create it lazily.
  defp ensure_table! do
    case :ets.info(@table) do
      :undefined -> init()
      _ -> :ok
    end
  end
end
