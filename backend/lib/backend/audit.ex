defmodule Backend.Audit do
  @moduledoc """
  Boundary for the field-level audit log. Every audited entity goes
  through one of `record_created/4`, `record_updated/5`, or
  `record_deleted/4` from inside its context's create / update /
  delete fns — this module never sniffs Ecto changesets directly so a
  context can stay in charge of *what* counts as a meaningful change.

  Listing/history reads are paginated via the same `{items,
  next_cursor}` shape every other list endpoint produces.

  Permission gating is the caller's job — we don't second-guess
  whether the actor was allowed to see this entity. The HTTP layer
  (`AuditController.index`) routes by entity_type and applies the
  matching `<entity>.view` check before calling in.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Audit.AuditEvent
  alias Backend.ListQueries
  alias Backend.Repo

  ## Write paths ------------------------------------------------------

  @doc """
  Stamp a "created" event with the row's full state. `attrs_after`
  should be the keyword/map of columns the create fn actually wrote.
  """
  def record_created(actor, entity_type, entity, attrs_after) do
    insert_event(
      actor,
      entity_type,
      entity,
      "created",
      to_diff(%{}, attrs_after),
      stringify_state(attrs_after)
    )
  end

  @doc """
  Stamp an "updated" event with the field-level diff between `before`
  and `after`. Unchanged fields are excluded so the audit log doesn't
  grow with no-op edits.
  """
  def record_updated(actor, entity_type, entity, attrs_before, attrs_after) do
    diff = to_diff(attrs_before, attrs_after)
    if map_size(diff) == 0 do
      :noop
    else
      insert_event(
        actor,
        entity_type,
        entity,
        "updated",
        diff,
        stringify_state(attrs_after)
      )
    end
  end

  @doc """
  Stamp a "deleted" event with the row's last-known state. The
  `state_after` snapshot is empty for delete events — the row is gone,
  there's no "after" state to restore to.
  """
  def record_deleted(actor, entity_type, entity, attrs_before) do
    insert_event(
      actor,
      entity_type,
      entity,
      "deleted",
      to_diff(attrs_before, %{}),
      %{}
    )
  end

  ## Read paths -------------------------------------------------------

  @doc """
  Paginated history for one entity. Standard list opts (cursor, limit,
  sort). Default sort = `at desc` since "newest first" is what every
  history view wants.
  """
  def list_for_entity(company_id, entity_type, entity_id, opts \\ []) do
    sort = Keyword.get(opts, :sort, {:at, :desc})

    base =
      from(e in AuditEvent,
        where: e.company_id == ^company_id,
        where: e.entity_type == ^entity_type,
        where: e.entity_id == ^entity_id,
        preload: [:actor]
      )
      |> ListQueries.apply_sort(sort, ~w(at)a, {:at, :desc})

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  ## ------------------------------------------------------------------

  defp insert_event(actor, entity_type, entity, event, changes, state_after) do
    actor_snapshot =
      case actor do
        %User{} = u ->
          %{
            "id" => u.id,
            "name" => u.name,
            "email" => u.email,
            "avatar" => u.avatar
          }

        # System actor for cron / background jobs. Caller supplies at
        # least `:kind` (`"system"` / `"cron"`); we coerce all keys to
        # strings so JSONB stays uniform with the user shape above.
        %{kind: kind} = sys when is_binary(kind) ->
          sys
          |> Map.take([:kind, :name, :source])
          |> Map.new(fn {k, v} -> {to_string(k), v} end)

        _ ->
          %{}
      end

    # Sub-tables (raw_material_compliance, raw_material_risk_assessment,
    # finished_product_spec, packaging_compliance) use `item_id` as the
    # PK and don't carry their own `company_id` / `uuid` columns. Fall
    # back to the parent item for those so the audit row is still
    # tenant-scoped and the Activity card can navigate back.
    entity_id = Map.get(entity, :id) || Map.get(entity, :item_id)
    {company_id, entity_uuid} = derive_scope(entity)

    attrs = %{
      company_id: company_id,
      entity_type: entity_type,
      entity_id: entity_id,
      entity_uuid: entity_uuid,
      event: event,
      actor_id: actor_id(actor),
      actor_snapshot: actor_snapshot,
      changes: stringify_decimal_values(changes),
      state_after: stringify_decimal_values(state_after),
      at: DateTime.utc_now()
    }

    %AuditEvent{}
    |> Ecto.Changeset.cast(attrs, Map.keys(attrs))
    |> Repo.insert!()
  end

  defp actor_id(%User{id: id}), do: id
  defp actor_id(_), do: nil

  # Pull company_id + uuid from the entity itself; for sub-tables that
  # lack them, look up via the parent item. One small extra query per
  # audit write — cheap, and we never cache it.
  defp derive_scope(entity) do
    own_company = Map.get(entity, :company_id)
    own_uuid = Map.get(entity, :uuid)

    cond do
      not is_nil(own_company) ->
        {own_company, own_uuid}

      not is_nil(Map.get(entity, :item_id)) ->
        case Repo.get(Backend.Items.Item, Map.get(entity, :item_id)) do
          %{company_id: cid, uuid: uuid} -> {cid, own_uuid || uuid}
          _ -> {nil, own_uuid}
        end

      true ->
        {nil, own_uuid}
    end
  end

  # Jason doesn't ship a default Decimal encoder, so any Decimal value
  # in the snapshot crashes the JSONB write. Convert recursively to a
  # canonical string the FE can re-parse.
  defp stringify_decimal_values(map) when is_map(map) do
    Map.new(map, fn {k, v} -> {k, stringify_decimal(v)} end)
  end

  defp stringify_decimal_values(other), do: other

  defp stringify_decimal(%Decimal{} = d), do: Decimal.to_string(d, :normal)

  defp stringify_decimal(%{__struct__: _} = struct), do: struct

  defp stringify_decimal(%{} = m), do: stringify_decimal_values(m)

  defp stringify_decimal(list) when is_list(list),
    do: Enum.map(list, &stringify_decimal/1)

  defp stringify_decimal(other), do: other

  # `before` + `after` are flat field => value maps. Build a per-field
  # diff that omits unchanged fields and stringifies keys so the JSONB
  # column is human-readable.
  defp to_diff(before_map, after_map) do
    keys =
      MapSet.union(
        MapSet.new(Map.keys(before_map)),
        MapSet.new(Map.keys(after_map))
      )

    Enum.reduce(keys, %{}, fn key, acc ->
      old = Map.get(before_map, key)
      new = Map.get(after_map, key)

      if old == new do
        acc
      else
        Map.put(acc, to_string(key), %{
          "old" => normalize_value(old),
          "new" => normalize_value(new)
        })
      end
    end)
  end

  # JSONB can't hold structs (Decimal, DateTime, etc.) without an
  # encoder hook. Coerce to strings; UI re-parses when needed.
  defp normalize_value(%Decimal{} = d), do: Decimal.to_string(d)
  defp normalize_value(%DateTime{} = dt), do: DateTime.to_iso8601(dt)
  defp normalize_value(%Date{} = d), do: Date.to_iso8601(d)
  defp normalize_value(v), do: v

  # Same coercion as `normalize_value/1`, but applied to a whole
  # attrs map and with the keys stringified so the JSONB column is
  # self-describing.
  defp stringify_state(attrs) do
    Map.new(attrs, fn {k, v} -> {to_string(k), normalize_value(v)} end)
  end
end
