defmodule Backend.MisclickGuard do
  @moduledoc """
  Short-window request idempotency cache — catches double-clicks and
  network re-fires without touching individual endpoints.

  Model: a request is a misclick if a byte-for-byte identical request
  from the same actor lands within the TTL window. First request runs
  the handler; a second identical request within the window replays
  the first's cached response (same status + body + headers) instead
  of hitting the handler again.

  Backed by a single named ETS table so cache lookups don't need a
  GenServer round-trip. Same pattern as `Backend.HttpRateLimit`;
  survives across requests, doesn't survive a node restart (which is
  fine — a restart is way longer than the TTL and the client's
  in-flight request would have failed anyway).

  ### What the "fingerprint" is

  `sha256(actor_id | method | request_path | raw_body)`, hex-encoded.
  Two requests hash the same iff every one of those matches. That's
  the definition of a misclick: the SAME user, hitting the SAME
  button, sending the SAME payload, twice in a row.

  Different actor → different fingerprint (two people hitting the
  same button = two legitimate requests). Different query string /
  body → different fingerprint (edited the form between clicks =
  legitimate). Different method or path → different fingerprint
  (obviously).

  ### Concurrency

  Simple check-then-cache: no lock. Two TRULY simultaneous requests
  (< 1ms apart) can both slip past the miss check and both execute.
  This is fine because a human double-click is separated by
  100-500ms — comfortably longer than any handler's write-cache
  time — so the first request has already stored its response
  before the second arrives.

  A pathological programmatic burst could still race. The right fix
  for that is a proper Idempotency-Key header (client generates the
  key, we lock on it). This module is the "0-config" misclick guard;
  the Idempotency-Key middleware is the tier above for money
  endpoints.
  """

  @table :backend_misclick_guard

  # 10 seconds. Long enough for network re-fires (browser retry, fetch
  # abort/retry, mobile radio wake-up) and human double-click cadence.
  # Short enough to never catch a legitimate "yeah, I meant to click
  # it again to run it a second time" (nobody re-runs the same button
  # within 10s on purpose — they wait for feedback first).
  @default_ttl_seconds 10

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
  Look up a cached response by fingerprint.

  Returns `{:hit, {status, body_iodata, headers}}` when a live entry
  exists, `:miss` otherwise. Expired entries are treated as miss and
  cleaned up lazily on the next `put/3`.
  """
  @spec get(binary()) :: {:hit, {non_neg_integer(), iodata(), list()}} | :miss
  def get(fingerprint) when is_binary(fingerprint) do
    ensure_table!()

    case :ets.lookup(@table, fingerprint) do
      [{^fingerprint, {status, body, headers}, expires_at}] ->
        if System.system_time(:second) < expires_at do
          {:hit, {status, body, headers}}
        else
          # Stale — evict lazily so the next put on this key doesn't
          # observe a phantom hit.
          :ets.delete(@table, fingerprint)
          :miss
        end

      [] ->
        :miss
    end
  end

  @doc """
  Store a response snapshot under the fingerprint with a `ttl_seconds`
  lifetime. Overwrites any existing entry.
  """
  @spec put(binary(), {non_neg_integer(), iodata(), list()}, pos_integer()) :: :ok
  def put(fingerprint, {status, body, headers}, ttl_seconds \\ @default_ttl_seconds)
      when is_binary(fingerprint) and is_integer(status) do
    ensure_table!()

    expires_at = System.system_time(:second) + ttl_seconds
    :ets.insert(@table, {fingerprint, {status, body, headers}, expires_at})
    :ok
  end

  @doc """
  Compute the fingerprint for a request. See the moduledoc for what
  goes into the hash.
  """
  @spec fingerprint(term(), String.t(), String.t(), iodata()) :: binary()
  def fingerprint(actor_id, method, path, body) do
    :crypto.hash(
      :sha256,
      [
        to_string(actor_id),
        "|",
        method,
        "|",
        path,
        "|",
        body || ""
      ]
    )
    |> Base.encode16(case: :lower)
  end

  @doc "Default TTL in seconds (10)."
  def default_ttl_seconds, do: @default_ttl_seconds

  defp ensure_table! do
    case :ets.info(@table) do
      :undefined -> init()
      _ -> :ok
    end
  end
end
