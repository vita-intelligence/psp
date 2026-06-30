defmodule Backend.Production.ScheduleWalker do
  @moduledoc """
  Working-hour-aware placement for MO step times.

  Given a flat list of working-time intervals (already filtered for
  holidays + closed days), this module walks forward or backward to
  place a block of N seconds.

  The interval list shape is `[%{open: DateTime, close: DateTime}, ...]`
  in ascending order with no overlap. Build it from
  `Production.resolve_working_windows/5` then flatten per group/site.

  Two entry points:

    * `walk_forward(intervals, cursor, duration_seconds)` —
      lay a block down starting at or after `cursor`, splitting
      across windows as needed. Returns the actual start + finish
      times in working time.

    * `walk_backward(intervals, cursor, duration_seconds)` —
      same but the cursor is the deadline; the block ends at or
      before it. Used to schedule child MOs that must finish
      before their parent starts.

  Both return `{:ok, %{start_at, finish_at, segments, outside_hours_seconds}}`
  where `segments` is the list of `{open, close}` pairs the block
  occupies (useful for rendering across the closed gaps) and
  `outside_hours_seconds` is how much of the requested duration
  couldn't fit inside the supplied windows. Non-zero values mean
  the caller should warn the operator.
  """

  @type interval :: %{open: DateTime.t(), close: DateTime.t()}
  @type segment :: %{open: DateTime.t(), close: DateTime.t()}
  @type placement :: %{
          start_at: DateTime.t(),
          finish_at: DateTime.t(),
          segments: [segment()],
          outside_hours_seconds: integer()
        }

  @doc """
  Place a block of `duration_seconds` starting at or after `cursor`.
  Walks `intervals` in chronological order, packing into each
  working window. Anything that doesn't fit gets dumped at the end
  of the last window with the overflow counted in
  `outside_hours_seconds`.

  Optional capacity-aware mode via `opts`:

    * `:reservations` — list of `{start :: DateTime, finish :: DateTime}`
      blocks already scheduled on this WSG (excluding the step being
      placed). Defaults to `[]`.
    * `:capacity` — how many ops can run in parallel on the WSG
      (i.e. how many active Workstation rows live in the group).
      Defaults to `1`.

  When reservations + capacity are supplied, the walker first slices
  out any sub-interval where `concurrent reservations >= capacity`
  from the working windows, then walks the remaining free time. So
  a planner dropping an MO on a busy 10:00 slot lands at the next
  free gap automatically — the calendar never silently overbooks.
  """
  @spec walk_forward([interval()], DateTime.t(), non_neg_integer(), keyword()) ::
          {:ok, placement()}
  def walk_forward(intervals, %DateTime{} = cursor, duration_seconds, opts \\ [])
      when is_integer(duration_seconds) and duration_seconds >= 0 do
    if duration_seconds == 0 do
      {:ok, %{start_at: cursor, finish_at: cursor, segments: [], outside_hours_seconds: 0}}
    else
      free = apply_reservations(intervals, opts)

      do_walk_forward(
        Enum.sort_by(free, & &1.open, DateTime),
        cursor,
        duration_seconds,
        [],
        nil
      )
    end
  end

  defp apply_reservations(intervals, opts) do
    reservations = Keyword.get(opts, :reservations, [])
    capacity = Keyword.get(opts, :capacity, 1)

    cond do
      reservations == [] -> intervals
      capacity <= 0 -> []
      true -> subtract_intervals(intervals, busy_intervals(reservations, capacity))
    end
  end

  # Sweep-line over reservation start / finish events. Whenever the
  # concurrent count is at or above capacity, we accumulate a "busy"
  # interval. At equal timestamps we process finish (-1) before start
  # (+1) so back-to-back bookings (A finishes at 10:00, B starts at
  # 10:00) do not register as a concurrent overlap.
  defp busy_intervals(reservations, capacity)
       when is_list(reservations) and is_integer(capacity) and capacity >= 1 do
    events =
      reservations
      |> Enum.flat_map(fn {s, f} -> [{s, +1}, {f, -1}] end)
      |> Enum.sort_by(fn {t, delta} -> {DateTime.to_unix(t, :microsecond), -delta} end)

    {busy, _count, _open} =
      Enum.reduce(events, {[], 0, nil}, fn {t, delta}, {acc, count, open_at} ->
        new_count = count + delta

        cond do
          # Crossed up into "at capacity" — start a busy interval.
          count < capacity and new_count >= capacity ->
            {acc, new_count, t}

          # Dropped back below capacity — close the open busy interval.
          count >= capacity and new_count < capacity and not is_nil(open_at) ->
            {[%{open: open_at, close: t} | acc], new_count, nil}

          true ->
            {acc, new_count, open_at}
        end
      end)

    Enum.reverse(busy)
  end

  # Slice each working interval, removing time covered by any busy
  # interval. Both lists are assumed roughly sorted; we sort defensively.
  defp subtract_intervals(working, []), do: working

  defp subtract_intervals(working, busy) do
    busy_sorted = Enum.sort_by(busy, & &1.open, DateTime)

    Enum.flat_map(working, fn w ->
      subtract_one(w, busy_sorted)
    end)
  end

  defp subtract_one(w, []), do: [w]

  defp subtract_one(%{open: w_open, close: w_close} = w, [b | rest]) do
    cond do
      # busy entirely before working window — skip
      DateTime.compare(b.close, w_open) != :gt ->
        subtract_one(w, rest)

      # busy entirely after — done with this window
      DateTime.compare(b.open, w_close) != :lt ->
        [w]

      # overlap — cut window around busy
      true ->
        head =
          if DateTime.compare(b.open, w_open) == :gt do
            [%{open: w_open, close: b.open}]
          else
            []
          end

        tail_window =
          if DateTime.compare(b.close, w_close) == :lt do
            %{open: b.close, close: w_close}
          else
            nil
          end

        if tail_window do
          head ++ subtract_one(tail_window, rest)
        else
          head
        end
    end
  end

  defp do_walk_forward([], cursor, remaining, segments, start_at) do
    # Ran out of windows — place the remainder starting at the
    # cursor (which may be after the last window's close).
    overflow_finish = DateTime.add(cursor, remaining, :second)
    seg = %{open: cursor, close: overflow_finish}

    {:ok,
     %{
       start_at: start_at || cursor,
       finish_at: overflow_finish,
       segments: Enum.reverse([seg | segments]),
       outside_hours_seconds: remaining
     }}
  end

  defp do_walk_forward([w | rest], cursor, remaining, segments, start_at) do
    cond do
      # Window ends before cursor — skip it.
      DateTime.compare(w.close, cursor) != :gt ->
        do_walk_forward(rest, cursor, remaining, segments, start_at)

      true ->
        effective_start =
          if DateTime.compare(w.open, cursor) == :gt, do: w.open, else: cursor

        span_seconds = DateTime.diff(w.close, effective_start, :second)

        if span_seconds >= remaining do
          finish = DateTime.add(effective_start, remaining, :second)
          seg = %{open: effective_start, close: finish}

          {:ok,
           %{
             start_at: start_at || effective_start,
             finish_at: finish,
             segments: Enum.reverse([seg | segments]),
             outside_hours_seconds: 0
           }}
        else
          seg = %{open: effective_start, close: w.close}

          do_walk_forward(
            rest,
            w.close,
            remaining - span_seconds,
            [seg | segments],
            start_at || effective_start
          )
        end
    end
  end

  @doc """
  Place a block of `duration_seconds` finishing at or before `cursor`.
  Walks `intervals` in reverse, packing into each working window
  from the back. Like `walk_forward/3`, anything that doesn't fit
  gets dumped before the first window with the overflow counted in
  `outside_hours_seconds`.
  """
  @spec walk_backward([interval()], DateTime.t(), non_neg_integer()) ::
          {:ok, placement()}
  def walk_backward(intervals, %DateTime{} = cursor, duration_seconds)
      when is_integer(duration_seconds) and duration_seconds >= 0 do
    if duration_seconds == 0 do
      {:ok, %{start_at: cursor, finish_at: cursor, segments: [], outside_hours_seconds: 0}}
    else
      do_walk_backward(
        Enum.sort_by(intervals, & &1.open, {:desc, DateTime}),
        cursor,
        duration_seconds,
        [],
        nil
      )
    end
  end

  defp do_walk_backward([], cursor, remaining, segments, finish_at) do
    overflow_start = DateTime.add(cursor, -remaining, :second)
    seg = %{open: overflow_start, close: cursor}

    {:ok,
     %{
       start_at: overflow_start,
       finish_at: finish_at || cursor,
       segments: [seg | segments],
       outside_hours_seconds: remaining
     }}
  end

  defp do_walk_backward([w | rest], cursor, remaining, segments, finish_at) do
    cond do
      # Window opens after the cursor — skip it.
      DateTime.compare(w.open, cursor) != :lt ->
        do_walk_backward(rest, cursor, remaining, segments, finish_at)

      true ->
        effective_close =
          if DateTime.compare(w.close, cursor) == :lt, do: w.close, else: cursor

        span_seconds = DateTime.diff(effective_close, w.open, :second)

        if span_seconds >= remaining do
          start = DateTime.add(effective_close, -remaining, :second)
          seg = %{open: start, close: effective_close}

          {:ok,
           %{
             start_at: start,
             finish_at: finish_at || effective_close,
             segments: [seg | segments],
             outside_hours_seconds: 0
           }}
        else
          seg = %{open: w.open, close: effective_close}

          do_walk_backward(
            rest,
            w.open,
            remaining - span_seconds,
            [seg | segments],
            finish_at || effective_close
          )
        end
    end
  end

  @doc """
  Flatten a `resolve_working_windows/5` shape — list of groups,
  each with a day-by-day windows list — into a single deduplicated,
  sorted list of intervals suitable for the walkers.

  When `group_id` is given, only that group's windows are kept.
  When nil, all groups' windows are union'd (used for site-level
  schedule placement when we don't care which WSG).
  """
  @spec flatten_windows([%{group_id: integer(), days: [map()]}], integer() | nil) :: [interval()]
  def flatten_windows(windows, group_id \\ nil) do
    windows
    |> Enum.filter(fn w -> group_id == nil or w.group_id == group_id end)
    |> Enum.flat_map(fn w ->
      Enum.flat_map(w.days, fn d -> d.intervals end)
    end)
    |> Enum.map(fn %{open: o, close: c} -> %{open: o, close: c} end)
    |> dedupe_and_sort()
  end

  defp dedupe_and_sort(intervals) do
    intervals
    |> Enum.uniq_by(fn %{open: o, close: c} ->
      {DateTime.to_unix(o), DateTime.to_unix(c)}
    end)
    |> Enum.sort_by(& &1.open, DateTime)
  end
end
