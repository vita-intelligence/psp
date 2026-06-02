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
  alias Backend.Warehouses.Warehouse

  ## Listing / fetching ----------------------------------------------

  def list_for_company(company_id) do
    Warehouse
    |> where([w], w.company_id == ^company_id)
    |> order_by([w], asc: w.is_active == false, asc: w.name)
    |> Repo.all()
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
