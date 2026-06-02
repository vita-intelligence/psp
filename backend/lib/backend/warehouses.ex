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
  alias Backend.Repo
  alias Backend.Companies
  alias Backend.ListQueries
  alias Backend.Warehouses.Warehouse

  # Whitelisted column names the table is allowed to sort by. Anything
  # outside this list silently falls back to @default_sort — protects
  # against SQL injection AND accidentally sorting on a sensitive col.
  @sortable_fields ~w(name code is_active inserted_at)a
  # Equality filters the API will honour.
  @filter_fields ~w(is_active)a
  # Columns the free-text `search` parameter ILIKE'es against.
  @search_fields ~w(name code address)a
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
    sort = Keyword.get(opts, :sort, @default_sort)

    base =
      Warehouse
      |> where([w], w.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @search_fields)
      |> ListQueries.apply_filter(opts[:filters], @filter_fields)
      |> ListQueries.apply_sort(sort, @sortable_fields, @default_sort)

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

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

  def get_for_company(company_id, id) do
    Repo.get_by(Warehouse, id: id, company_id: company_id)
  end

  def get_for_company!(company_id, id) do
    Repo.get_by!(Warehouse, id: id, company_id: company_id)
  end

  ## Mutation --------------------------------------------------------

  def create(company_id, attrs) do
    %Warehouse{}
    |> Warehouse.changeset(Map.put(stringify_keys(attrs), "company_id", company_id))
    |> Repo.insert()
  end

  def update(%Warehouse{} = warehouse, attrs) do
    warehouse
    |> Warehouse.changeset(stringify_keys(attrs))
    |> Repo.update()
  end

  def delete(%Warehouse{} = warehouse), do: Repo.delete(warehouse)

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
