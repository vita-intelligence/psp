defmodule Backend.Warehouses do
  @moduledoc """
  Boundary for warehouses CRUD + inheritance resolvers.

  The inheritance pattern: each warehouse may override `timezone`,
  `working_hours`, and `holidays`; when the field is `nil` we fall
  back to the parent company. Callers should ALWAYS use the
  `effective_*` resolvers instead of reading the field directly so
  the fallback isn't accidentally bypassed.
  """

  import Ecto.Query, warn: false
  alias Backend.Audit
  alias Backend.Repo
  alias Backend.Companies
  alias Backend.ListQueries
  alias Backend.Warehouses.{Floor, StorageCell, StorageLocation, Warehouse}

  # Surface the audit log treats as meaningful. Internal bookkeeping
  # (created_by_id, updated_by_id) is excluded so history rows only
  # show user-visible field changes.
  @audit_fields ~w(name address notes is_active timezone working_hours holidays contacts plan)a

  # Whitelisted column names the table is allowed to sort by. Anything
  # outside this list silently falls back to @default_sort — protects
  # against SQL injection AND accidentally sorting on a sensitive col.
  # `code` is a render-time field (prefix + padded id) — sorting by it
  # is equivalent to sorting by :id, so the list_for_company helper
  # translates `:code` → `:id` before passing to ListQueries.
  @sortable_fields ~w(id name is_active inserted_at)a
  # Equality filters the API will honour.
  @filter_fields ~w(is_active)a
  # Columns the free-text `search` parameter ILIKE'es against. `code`
  # search is handled separately via Numbering.parse_search.
  @search_fields ~w(name address)a
  @default_sort {:name, :asc}

  ## Listing / fetching ----------------------------------------------

  @doc """
  Paginated, sortable, filterable, searchable list. `opts` keys:

    * `:cursor`  — opaque cursor from the previous page (or nil for first page)
    * `:limit`   — page size (clamped by ListQueries)
    * `:sort`    — `{:name, :asc}` etc; must be in @sortable_fields
    * `:filters` — `%{is_active: true}` etc; must be in @filter_fields
    * `:search`  — free-text ILIKE across @search_fields

  Returns `{items, next_cursor}` — `next_cursor` is `nil` when the
  caller has reached the end.
  """
  def list_for_company(company_id, opts \\ []) do
    sort = normalise_sort(Keyword.get(opts, :sort, @default_sort))
    # Default scope = warehouse-kind so legacy call sites stay unchanged.
    # Controllers managing the production-facility surface pass
    # `kind: "production_facility"`; pass `:any` to opt out entirely.
    kind = Keyword.get(opts, :kind, "warehouse")

    base =
      Warehouse
      |> where([w], w.company_id == ^company_id)
      |> kind_scope(kind)
      |> ListQueries.apply_search(opts[:search], @search_fields)
      |> ListQueries.apply_filter(opts[:filters], @filter_fields)
      |> ListQueries.apply_column_filters(opts[:column_filter], @sortable_fields)
      |> ListQueries.apply_sort(sort, @sortable_fields, @default_sort)
      |> preload([:created_by, :updated_by])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp kind_scope(query, :any), do: query
  defp kind_scope(query, nil), do: query
  defp kind_scope(query, kind) when kind in ~w(warehouse production_facility),
    do: where(query, [w], w.kind == ^kind)

  defp kind_scope(query, _other), do: query

  # FE sends `sort=code:asc` from the Code column header. The display
  # code is `prefix + lpad(id, padding)` so id order = code order under
  # any consistent format — translate before Ecto sees it.
  defp normalise_sort({:code, dir}), do: {:id, dir}
  defp normalise_sort(other), do: other

  @doc "Static config the frontend reads to drive its column controls."
  def list_config do
    %{
      sortable_fields: Enum.map(@sortable_fields, &Atom.to_string/1),
      filter_fields: Enum.map(@filter_fields, &Atom.to_string/1),
      search_fields: Enum.map(@search_fields, &Atom.to_string/1),
      default_sort: %{
        field: Atom.to_string(elem(@default_sort, 0)),
        direction: Atom.to_string(elem(@default_sort, 1))
      }
    }
  end

  @doc """
  Lookup by public UUID, scoped to the actor's company. `uuid` is a
  string from the URL/path; if it doesn't parse as a valid UUID we
  return `nil` so controllers can render a clean 404 instead of
  bubbling an Ecto.Query error.
  """
  def get_for_company(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Warehouse
        |> Repo.get_by(uuid: cast, company_id: company_id)
        |> case do
          nil -> nil
          warehouse -> Repo.preload(warehouse, [:created_by, :updated_by])
        end

      :error ->
        nil
    end
  end

  def get_for_company(_company_id, _), do: nil

  @doc """
  Like `get_for_company/2` but refuses to return a row whose `kind`
  doesn't match — used by the kind-scoped controllers so e.g. a
  GET /api/production/facilities/<uuid> can never return a regular
  warehouse and vice versa.
  """
  def get_for_company_kind(company_id, uuid, kind)
      when is_binary(uuid) and kind in ~w(warehouse production_facility) do
    case get_for_company(company_id, uuid) do
      %Warehouse{kind: ^kind} = w -> w
      _ -> nil
    end
  end

  def get_for_company_kind(_company_id, _uuid, _kind), do: nil

  ## Mutation --------------------------------------------------------

  @doc """
  Create a warehouse. `actor` is the user pushing the change — used
  to stamp `created_by_id` + `updated_by_id` so the audit metadata is
  populated from row one.
  """
  def create(%Backend.Accounts.User{} = actor, company_id, attrs) do
    %Warehouse{}
    |> Warehouse.changeset(
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "company_id" => company_id,
        "created_by_id" => actor.id,
        "updated_by_id" => actor.id
      })
    )
    |> Repo.insert()
    |> after_create(actor)
  end

  def update(%Backend.Accounts.User{} = actor, %Warehouse{} = warehouse, attrs) do
    before_state = audit_snapshot(warehouse)

    warehouse
    |> Warehouse.changeset(
      attrs
      |> stringify_keys()
      |> Map.put("updated_by_id", actor.id)
    )
    |> Repo.update()
    |> after_update(actor, before_state)
  end

  defp after_create({:ok, warehouse}, actor) do
    Audit.record_created(actor, "warehouse", warehouse, audit_snapshot(warehouse))
    {:ok, Repo.preload(warehouse, [:created_by, :updated_by])}
  end

  defp after_create(other, _actor), do: other

  defp after_update({:ok, warehouse}, actor, before_state) do
    Audit.record_updated(
      actor,
      "warehouse",
      warehouse,
      before_state,
      audit_snapshot(warehouse)
    )

    {:ok, Repo.preload(warehouse, [:created_by, :updated_by])}
  end

  defp after_update(other, _actor, _before_state), do: other

  defp audit_snapshot(%Warehouse{} = w),
    do: Map.new(@audit_fields, fn k -> {k, Map.get(w, k)} end)

  def delete(%Backend.Accounts.User{} = actor, %Warehouse{} = warehouse) do
    before_state = audit_snapshot(warehouse)

    case Repo.delete(warehouse) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "warehouse", warehouse, before_state)
        {:ok, deleted}

      other ->
        other
    end
  end

  ## Inheritance resolvers -------------------------------------------

  @doc """
  Returns the effective timezone for the warehouse:
    1. its own `timezone` field if set
    2. otherwise the parent company's
  """
  def effective_timezone(%Warehouse{timezone: tz}) when is_binary(tz) and tz != "", do: tz

  def effective_timezone(%Warehouse{}) do
    Companies.current().timezone
  end

  @doc """
  Returns `{value, source}` where `source` is `:warehouse` or `:company`.
  Useful for the UI to render "Inherited from company" labels.
  """
  def effective_with_source(%Warehouse{} = w, field)
      when field in [:timezone, :working_hours, :holidays] do
    case Map.get(w, field) do
      nil ->
        {Map.get(Companies.current(), field), :company}

      v when v == %{} ->
        # An empty bag counts as "no override" for inherited fields —
        # the UI treats it the same way as nil.
        {Map.get(Companies.current(), field), :company}

      value ->
        {value, :warehouse}
    end
  end

  def effective_working_hours(%Warehouse{} = w) do
    {value, _source} = effective_with_source(w, :working_hours)
    value
  end

  @doc """
  Return the `(floor, location, cell)` tuple where this warehouse's
  unregistered stock lives. Lazy-creates the hierarchy on first call
  so brand-new warehouses don't need a special bootstrap step.

  Manual lot creation routes every batch here; later scan-moves shift
  stock to a real shelf.
  """
  def get_or_create_unregistered_cell!(%Warehouse{id: warehouse_id, company_id: company_id}) do
    case find_unregistered_cell(warehouse_id) do
      %StorageCell{} = cell ->
        cell

      nil ->
        Repo.transaction(fn ->
          floor = upsert_unregistered_floor(warehouse_id, company_id)
          location = upsert_unregistered_location(warehouse_id, company_id, floor.id)
          upsert_unregistered_cell(company_id, location.id)
        end)
        |> case do
          {:ok, cell} -> cell
          {:error, reason} -> raise "couldn't provision unregistered cell: #{inspect(reason)}"
        end
    end
  end

  defp find_unregistered_cell(warehouse_id) do
    Repo.one(
      from c in StorageCell,
        join: l in StorageLocation,
        on: l.id == c.storage_location_id,
        where:
          l.warehouse_id == ^warehouse_id and c.system_kind == "unregistered",
        limit: 1
    )
  end

  defp upsert_unregistered_floor(warehouse_id, company_id) do
    case Repo.one(
           from f in Floor,
             where:
               f.warehouse_id == ^warehouse_id and f.system_kind == "unregistered",
             limit: 1
           ) do
      %Floor{} = f ->
        f

      nil ->
        %Floor{}
        |> Ecto.Changeset.change(%{
          warehouse_id: warehouse_id,
          company_id: company_id,
          name: "(System)",
          ordinal: -1,
          canvas_json: %{},
          system_kind: "unregistered"
        })
        |> Repo.insert!()
    end
  end

  defp upsert_unregistered_location(warehouse_id, company_id, floor_id) do
    case Repo.one(
           from l in StorageLocation,
             where:
               l.warehouse_id == ^warehouse_id and l.system_kind == "unregistered",
             limit: 1
           ) do
      %StorageLocation{} = l ->
        l

      nil ->
        %StorageLocation{}
        |> Ecto.Changeset.change(%{
          warehouse_id: warehouse_id,
          floor_id: floor_id,
          company_id: company_id,
          name: "Unregistered",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          tags: [],
          system_kind: "unregistered"
        })
        |> Repo.insert!()
    end
  end

  defp upsert_unregistered_cell(company_id, location_id) do
    case Repo.one(
           from c in StorageCell,
             where:
               c.storage_location_id == ^location_id and
                 c.system_kind == "unregistered",
             limit: 1
           ) do
      %StorageCell{} = c ->
        c

      nil ->
        %StorageCell{}
        |> Ecto.Changeset.change(%{
          storage_location_id: location_id,
          company_id: company_id,
          name: "Unregistered",
          ordinal: 0,
          tags: [],
          system_kind: "unregistered"
        })
        |> Repo.insert!()
    end
  end

  def effective_holidays(%Warehouse{} = w) do
    {value, _source} = effective_with_source(w, :holidays)
    value
  end

  ## ------------------------------------------------------------------

  defp stringify_keys(attrs) do
    Enum.into(attrs, %{}, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end
end
