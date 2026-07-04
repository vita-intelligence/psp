defmodule Backend.ListQueries do
  @moduledoc """
  Composable query helpers for paginated, sorted, filtered, searchable
  list endpoints. Every resource's `list_*` context function should
  pipe through these so the API surface stays consistent and the table
  component on the frontend can drive any list with the same code.

  Convention for endpoints:

      GET /api/<resource>?cursor=<opaque>&sort=field:dir
                        &filter[k]=v&search=q&limit=N
      → { items: [...], next_cursor: "..." | nil }

  ## Cursor strategy

  Keyset pagination on `(sort_field_value, id)` — stable under
  concurrent inserts (no row-shift like offset has) and O(log n)
  regardless of page depth. The cursor is `base64({field, dir, value, id})`
  so a sort change invalidates older cursors safely (we reject them).

  ## Allowed fields

  Each helper takes an explicit whitelist. Never accept the field name
  straight off the request — that's how SQL injection landed.
  """

  import Ecto.Query, warn: false

  @default_limit 25
  @max_limit 100

  ## Search ---------------------------------------------------------

  @doc """
  Apply a free-text ILIKE search across the given fields. Empty terms
  are a no-op (returns the query unchanged).
  """
  def apply_search(query, nil, _fields), do: query
  def apply_search(query, "", _fields), do: query

  def apply_search(query, term, fields)
      when is_binary(term) and is_list(fields) and fields != [] do
    needle = "%" <> escape_like(String.trim(term)) <> "%"

    # Build the OR-chain as a single `dynamic` and apply it inside one
    # `where`. Folding `or_where: ilike(...)` across the field list
    # instead would OR each ilike with the upstream `where`s (the
    # company-scope clause + any filter), which makes the search a
    # no-op as soon as the upstream clause matches every row.
    or_clause =
      Enum.reduce(fields, false, fn field, dyn ->
        dynamic([row], ilike(field(row, ^field), ^needle) or ^dyn)
      end)

    from row in query, where: ^or_clause
  end

  ## Filter ---------------------------------------------------------

  @doc """
  Apply key/value equality filters. Only fields in `allowed_fields`
  are applied; unknown keys are silently dropped (UI bugs shouldn't
  500 the API).
  """
  def apply_filter(query, nil, _allowed), do: query
  def apply_filter(query, filters, _allowed) when filters == %{}, do: query

  def apply_filter(query, filters, allowed_fields) when is_map(filters) do
    Enum.reduce(filters, query, fn {key, value}, acc ->
      field_atom = to_safe_atom(key, allowed_fields)
      if field_atom, do: where(acc, [row], field(row, ^field_atom) == ^cast_filter_value(value)), else: acc
    end)
  end

  ## Column filters (structured) -----------------------------------

  @doc """
  Apply structured per-column filters emitted by the DataTable v2
  header dropdown. Shape:

      %{
        "field_name" => %{"op" => "contains" | "eq" | "range" | "in",
                          "value" => ...}
      }

  Range accepts either `%{"min" => n, "max" => n}` (numeric) OR
  `%{"from" => "2026-01-01", "to" => "2026-06-30"}` (date). Either
  bound may be absent (open-ended).

  Only fields in `allowed_fields` are applied — every other field is
  silently dropped. This is the SQL-injection allowlist; controllers
  MUST pass it explicitly.

  Unrecognised ops are dropped. Empty strings / nil values are dropped
  so a filter chip with an empty input is a no-op instead of
  `WHERE field = ''` (which would match nothing on most columns).
  """
  def apply_column_filters(query, nil, _allowed), do: query
  def apply_column_filters(query, filters, _allowed) when filters == %{}, do: query

  def apply_column_filters(query, filters, allowed_fields) when is_map(filters) do
    Enum.reduce(filters, query, fn {field_key, spec}, acc ->
      case to_safe_atom(field_key, allowed_fields) do
        nil -> acc
        field_atom -> apply_column_filter_op(acc, field_atom, spec)
      end
    end)
  end

  defp apply_column_filter_op(query, field, %{"op" => "contains", "value" => value})
       when is_binary(value) and value != "" do
    needle = "%" <> escape_like(String.trim(value)) <> "%"
    from row in query, where: ilike(field(row, ^field), ^needle)
  end

  defp apply_column_filter_op(query, field, %{"op" => "eq", "value" => value})
       when not is_nil(value) do
    where(query, [row], field(row, ^field) == ^cast_filter_value(value))
  end

  defp apply_column_filter_op(query, field, %{"op" => "in", "value" => values})
       when is_list(values) and values != [] do
    cast = Enum.map(values, &cast_filter_value/1)
    where(query, [row], field(row, ^field) in ^cast)
  end

  # Numeric range: {min, max}. Either bound may be missing.
  defp apply_column_filter_op(query, field, %{"op" => "range"} = spec) do
    query
    |> apply_range_bound(field, :min, spec)
    |> apply_range_bound(field, :max, spec)
    |> apply_range_bound(field, :from, spec)
    |> apply_range_bound(field, :to, spec)
  end

  defp apply_column_filter_op(query, _field, _spec), do: query

  defp apply_range_bound(query, field, :min, %{"min" => value}) when not is_nil(value) do
    case cast_number(value) do
      {:ok, n} -> where(query, [row], field(row, ^field) >= ^n)
      :error -> query
    end
  end

  defp apply_range_bound(query, field, :max, %{"max" => value}) when not is_nil(value) do
    case cast_number(value) do
      {:ok, n} -> where(query, [row], field(row, ^field) <= ^n)
      :error -> query
    end
  end

  defp apply_range_bound(query, field, :from, %{"from" => value}) when is_binary(value) and value != "" do
    case cast_date(value) do
      {:ok, d} -> where(query, [row], field(row, ^field) >= ^d)
      :error -> query
    end
  end

  defp apply_range_bound(query, field, :to, %{"to" => value}) when is_binary(value) and value != "" do
    case cast_date(value) do
      # `<=` on a date bound matches any timestamp on that day up to
      # 23:59:59. For datetime columns we widen to end-of-day so
      # "until 2026-06-30" includes rows stamped `2026-06-30 15:12:00`.
      {:ok, d} -> where(query, [row], field(row, ^field) < ^Date.add(d, 1))
      :error -> query
    end
  end

  defp apply_range_bound(query, _field, _bound, _spec), do: query

  defp cast_number(n) when is_number(n), do: {:ok, n}

  defp cast_number(s) when is_binary(s) do
    trimmed = String.trim(s)

    with :error <- integer_parse_strict(trimmed),
         :error <- float_parse_strict(trimmed) do
      :error
    else
      {:ok, _} = ok -> ok
    end
  end

  defp cast_number(_), do: :error

  defp integer_parse_strict(s) do
    case Integer.parse(s) do
      {n, ""} -> {:ok, n}
      _ -> :error
    end
  end

  defp float_parse_strict(s) do
    case Float.parse(s) do
      {n, ""} -> {:ok, n}
      _ -> :error
    end
  end

  defp cast_date(s) when is_binary(s) do
    case Date.from_iso8601(s) do
      {:ok, d} -> {:ok, d}
      _ -> :error
    end
  end

  defp cast_date(_), do: :error

  ## Sort -----------------------------------------------------------

  @doc """
  Apply ordering. `sort_spec` is `{field, :asc | :desc}` or `nil` for
  the resource default. Unknown field falls back to default.

  Always tacks on `id` as a tiebreaker so the keyset cursor is unique.
  """
  def apply_sort(query, sort_spec, allowed_fields, default \\ nil)

  def apply_sort(query, nil, allowed_fields, default),
    do: apply_sort(query, default, allowed_fields, default)

  def apply_sort(query, {field, direction}, allowed_fields, default) do
    field_atom = to_safe_atom(field, allowed_fields)
    direction = if direction in [:asc, :desc], do: direction, else: :asc

    cond do
      field_atom == nil and default != nil ->
        apply_sort(query, default, allowed_fields, nil)

      field_atom == nil ->
        order_by(query, [row], asc: row.id)

      field_atom == :id ->
        order_by(query, [row], [{^direction, row.id}])

      true ->
        order_by(query, [row], [
          {^direction, field(row, ^field_atom)},
          {^direction, row.id}
        ])
    end
  end

  ## Cursor pagination ---------------------------------------------

  @doc """
  Apply the cursor where-clause + limit and run the query. Returns
  `{items, next_cursor}` — `next_cursor` is `nil` when there are no
  more pages.

  `sort_spec` must match what `apply_sort/4` was called with.
  """
  def paginate(repo, query, sort_spec, limit, cursor) do
    limit = clamp_limit(limit)

    query =
      query
      |> apply_cursor(sort_spec, cursor)
      |> limit(^(limit + 1))

    items = repo.all(query)

    {page, has_more} =
      if length(items) > limit do
        {Enum.take(items, limit), true}
      else
        {items, false}
      end

    next =
      if has_more, do: encode_cursor(sort_spec, List.last(page)), else: nil

    {page, next}
  end

  ## ----------------------------------------------------------------

  defp apply_cursor(query, _sort_spec, nil), do: query
  defp apply_cursor(query, _sort_spec, ""), do: query

  defp apply_cursor(query, sort_spec, cursor) when is_binary(cursor) do
    case decode_cursor(cursor) do
      {:ok, field, dir, value, id} ->
        case sort_spec do
          {^field, ^dir} -> cursor_where(query, field, dir, value, id)
          # Sort changed under the cursor — treat as "start over" to
          # avoid returning a wrong slice. Frontend should drop the
          # cursor when sort changes anyway.
          _ -> query
        end

      :error ->
        query
    end
  end

  defp cursor_where(query, :id, :asc, _value, id) do
    from row in query, where: row.id > ^id
  end

  defp cursor_where(query, :id, :desc, _value, id) do
    from row in query, where: row.id < ^id
  end

  defp cursor_where(query, field, :asc, value, id) do
    from row in query,
      where:
        field(row, ^field) > ^value or
          (field(row, ^field) == ^value and row.id > ^id)
  end

  defp cursor_where(query, field, :desc, value, id) do
    from row in query,
      where:
        field(row, ^field) < ^value or
          (field(row, ^field) == ^value and row.id < ^id)
  end

  defp encode_cursor({field, dir}, row) when is_atom(field) do
    value = Map.get(row, field)

    %{
      "f" => Atom.to_string(field),
      "d" => Atom.to_string(dir),
      "v" => encode_cursor_value(value),
      "i" => row.id
    }
    |> Jason.encode!()
    |> Base.url_encode64(padding: false)
  end

  defp encode_cursor(_default, row) do
    encode_cursor({:id, :asc}, row)
  end

  defp encode_cursor_value(%DateTime{} = dt), do: DateTime.to_iso8601(dt)
  defp encode_cursor_value(%NaiveDateTime{} = ndt), do: NaiveDateTime.to_iso8601(ndt)
  defp encode_cursor_value(%Date{} = d), do: Date.to_iso8601(d)
  defp encode_cursor_value(value), do: value

  defp decode_cursor(encoded) do
    with {:ok, json} <- Base.url_decode64(encoded, padding: false),
         {:ok, %{"f" => field_str, "d" => dir_str, "v" => raw_v, "i" => id}}
         when is_binary(field_str) and is_binary(dir_str) and is_integer(id) <-
           Jason.decode(json) do
      field = String.to_existing_atom(field_str)
      dir = String.to_existing_atom(dir_str)
      {:ok, field, dir, decode_cursor_value(raw_v), id}
    else
      _ -> :error
    end
  rescue
    ArgumentError -> :error
  end

  # Best-effort revival — `inserted_at` strings come back as ISO8601;
  # everything else stays as decoded JSON.
  defp decode_cursor_value(value) when is_binary(value) do
    case DateTime.from_iso8601(value) do
      {:ok, dt, _} -> dt
      _ -> value
    end
  end

  defp decode_cursor_value(value), do: value

  ## ----------------------------------------------------------------

  defp to_safe_atom(name, allowed) when is_atom(name) do
    if name in allowed, do: name, else: nil
  end

  defp to_safe_atom(name, allowed) when is_binary(name) do
    if Enum.any?(allowed, &(Atom.to_string(&1) == name)) do
      String.to_existing_atom(name)
    else
      nil
    end
  rescue
    ArgumentError -> nil
  end

  defp to_safe_atom(_, _), do: nil

  defp cast_filter_value("true"), do: true
  defp cast_filter_value("false"), do: false
  defp cast_filter_value(value), do: value

  defp clamp_limit(nil), do: @default_limit
  defp clamp_limit(n) when is_integer(n) and n > 0, do: min(n, @max_limit)

  defp clamp_limit(s) when is_binary(s) do
    case Integer.parse(s) do
      {n, _} when n > 0 -> min(n, @max_limit)
      _ -> @default_limit
    end
  end

  defp clamp_limit(_), do: @default_limit

  defp escape_like(s) do
    s
    |> String.replace("\\", "\\\\")
    |> String.replace("%", "\\%")
    |> String.replace("_", "\\_")
  end

  @doc "Default page size — exposed so controllers can reuse the constant."
  def default_limit, do: @default_limit

  @doc "Max page size — controllers should not allow exceeding this."
  def max_limit, do: @max_limit
end
