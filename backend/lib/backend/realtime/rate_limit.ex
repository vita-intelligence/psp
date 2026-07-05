defmodule Backend.Realtime.RateLimit do
  @moduledoc """
  Per-socket rate limiter for realtime channel messages.

  Channel handlers like `cursor:move`, `field:change`, `canvas:patch`
  are pure rebroadcasts — the server passes payloads straight through
  to every other peer in the room. A hostile client could push
  thousands of frames per second to fan out and pin every peer's
  render loop. This limiter counts messages per socket per rolling
  1-second window and returns `:limited` once the cap is hit; the
  caller drops the message silently.

  State lives in `socket.assigns` under a small set of stable atoms —
  no dynamic atom creation, no ETS.
  """

  @counter_atoms %{
    cursor: {:rl_cursor_start, :rl_cursor_count},
    field_change: {:rl_field_change_start, :rl_field_change_count},
    canvas_patch: {:rl_canvas_patch_start, :rl_canvas_patch_count},
    generic: {:rl_generic_start, :rl_generic_count}
  }

  # High-frequency: cursor / field change. Moderate: canvas patches.
  # Generic bucket for anything else that comes through.
  @limits %{
    cursor: 60,
    field_change: 120,
    canvas_patch: 30,
    generic: 60
  }

  @doc """
  Charge one message against the socket's bucket for `kind`. Returns
  `{:ok, socket}` when the bucket has room, `{:limited, socket}` when
  the second's cap has been hit.
  """
  @spec check(Phoenix.Socket.t(), atom) ::
          {:ok, Phoenix.Socket.t()} | {:limited, Phoenix.Socket.t()}
  def check(%Phoenix.Socket{} = socket, kind) when is_atom(kind) do
    {start_key, count_key} = Map.fetch!(@counter_atoms, kind)
    limit = Map.fetch!(@limits, kind)
    now = System.system_time(:second)

    prev_start = socket.assigns[start_key]
    prev_count = socket.assigns[count_key] || 0

    {start, count} =
      if prev_start == now do
        {now, prev_count + 1}
      else
        {now, 1}
      end

    socket =
      socket
      |> Phoenix.Socket.assign(start_key, start)
      |> Phoenix.Socket.assign(count_key, count)

    if count > limit do
      {:limited, socket}
    else
      {:ok, socket}
    end
  end
end
