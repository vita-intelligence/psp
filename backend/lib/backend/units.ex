defmodule Backend.Units do
  @moduledoc """
  Boundary for the company-scoped units-of-measurement registry.

  Reads return the list used by the admin DataTable and by item-level
  pickers when items land. Conversion is a single multiply within a
  dimension; this module exposes `convert/3` so callers don't reach
  into the schema directly.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.ListQueries
  alias Backend.Repo
  alias Backend.Units.UnitOfMeasurement

  @audit_fields ~w(name symbol dimension factor_to_base is_base is_active)a
  # `code` sorts are remapped to `:id` (display code derives from id).
  @sortable_fields ~w(id name symbol dimension factor_to_base is_base is_active inserted_at updated_at)a
  @search_fields ~w(name symbol)a
  @default_sort {:name, :asc}

  ## ----- read ------------------------------------------------------

  def list_page(company_id, opts \\ []) do
    sort = normalise_sort(Keyword.get(opts, :sort, @default_sort))

    base =
      UnitOfMeasurement
      |> where([u], u.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @search_fields)
      |> ListQueries.apply_column_filters(opts[:column_filter], @sortable_fields)
      |> ListQueries.apply_sort(sort, @sortable_fields, @default_sort)
      |> preload([:created_by, :updated_by])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp normalise_sort({:code, dir}), do: {:id, dir}
  defp normalise_sort(other), do: other

  def list_config do
    %{
      sortable_fields: Enum.map(@sortable_fields, &Atom.to_string/1),
      search_fields: Enum.map(@search_fields, &Atom.to_string/1),
      default_sort: %{
        field: Atom.to_string(elem(@default_sort, 0)),
        direction: Atom.to_string(elem(@default_sort, 1))
      }
    }
  end

  def list_for_company(company_id, opts \\ []) do
    base =
      from(u in UnitOfMeasurement,
        where: u.company_id == ^company_id,
        order_by: [asc: u.dimension, asc: u.name],
        preload: [:created_by, :updated_by]
      )

    case Keyword.get(opts, :dimension) do
      nil ->
        Repo.all(base)

      dim when is_binary(dim) ->
        Repo.all(from(u in base, where: u.dimension == ^dim))
    end
  end

  def get_for_company(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from(u in UnitOfMeasurement,
            where: u.company_id == ^company_id and u.uuid == ^cast,
            preload: [:created_by, :updated_by]
          )
        )

      :error ->
        nil
    end
  end

  def get_for_company(_company_id, _), do: nil

  @doc """
  Convert `quantity` from `from_unit` to `to_unit`. Both must belong
  to the same dimension; mismatched dimensions return
  `{:error, :dimension_mismatch}`. Math:

      base_qty = quantity * from_unit.factor_to_base
      converted = base_qty / to_unit.factor_to_base
  """
  def convert(quantity, %UnitOfMeasurement{} = from, %UnitOfMeasurement{} = to) do
    cond do
      from.dimension != to.dimension ->
        {:error, :dimension_mismatch}

      true ->
        q = to_decimal(quantity)
        base = Decimal.mult(q, from.factor_to_base)
        {:ok, Decimal.div(base, to.factor_to_base)}
    end
  end

  defp to_decimal(%Decimal{} = d), do: d
  defp to_decimal(n) when is_integer(n), do: Decimal.new(n)
  defp to_decimal(n) when is_float(n), do: Decimal.from_float(n)
  defp to_decimal(s) when is_binary(s), do: Decimal.new(s)

  ## ----- mutation --------------------------------------------------

  def create(%User{} = actor, company_id, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "company_id" => company_id,
        "created_by_id" => actor.id,
        "updated_by_id" => actor.id
      })

    %UnitOfMeasurement{}
    |> UnitOfMeasurement.changeset(attrs)
    |> Repo.insert()
    |> after_create(actor)
  end

  def update(%User{} = actor, %UnitOfMeasurement{} = unit, attrs) do
    before_state = snapshot(unit)

    unit
    |> UnitOfMeasurement.changeset(
      attrs
      |> stringify_keys()
      |> Map.put("updated_by_id", actor.id)
    )
    |> Repo.update()
    |> after_update(actor, before_state)
  end

  def delete(%User{} = actor, %UnitOfMeasurement{} = unit) do
    before_state = snapshot(unit)

    case Repo.delete(unit) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "unit_of_measurement", unit, before_state)
        Backend.Broadcasts.entity_changed("unit-of-measurement", unit.uuid, unit.company_id, "deleted")
        {:ok, deleted}

      other ->
        other
    end
  end

  ## ----- seed ------------------------------------------------------

  @doc """
  Seed the SI-aligned defaults for a freshly-created company. Called
  from `Backend.Companies.create/1` (or similar bootstrap). Idempotent
  via `on_conflict: :nothing` keyed on (company_id, symbol).
  """
  def seed_defaults_for_company(company_id) when is_integer(company_id) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    rows =
      Enum.map(default_seed_rows(), fn row ->
        row
        |> Map.put(:company_id, company_id)
        |> Map.put(:inserted_at, now)
        |> Map.put(:updated_at, now)
      end)

    Repo.insert_all(
      UnitOfMeasurement,
      rows,
      on_conflict: :nothing,
      conflict_target: [:company_id, :symbol]
    )
  end

  defp default_seed_rows do
    [
      # Mass — kg is base
      row("Kilogram", "kg", "mass", "1", true),
      row("Gram", "g", "mass", "0.001", false),
      row("Milligram", "mg", "mass", "0.000001", false),
      row("Pound", "lb", "mass", "0.453592370", false),
      row("Ounce", "oz", "mass", "0.028349523", false),

      # Volume — L is base
      row("Litre", "L", "volume", "1", true),
      row("Millilitre", "mL", "volume", "0.001", false),

      # Count — pcs is base
      row("Pieces", "pcs", "count", "1", true),
      row("Dozen", "dozen", "count", "12", false),

      # Length — m is base
      row("Metre", "m", "length", "1", true),
      row("Centimetre", "cm", "length", "0.01", false),
      row("Millimetre", "mm", "length", "0.001", false)
    ]
  end

  defp row(name, symbol, dimension, factor, is_base) do
    %{
      name: name,
      symbol: symbol,
      dimension: dimension,
      factor_to_base: Decimal.new(factor),
      is_base: is_base,
      is_active: true
    }
  end

  ## ----- helpers ---------------------------------------------------

  defp after_create({:ok, unit}, actor) do
    Audit.record_created(actor, "unit_of_measurement", unit, snapshot(unit))
    Backend.Broadcasts.entity_changed("unit-of-measurement", unit.uuid, unit.company_id, "created")
    {:ok, Repo.preload(unit, [:created_by, :updated_by])}
  end

  defp after_create(other, _actor), do: other

  defp after_update({:ok, unit}, actor, before_state) do
    Audit.record_updated(actor, "unit_of_measurement", unit, before_state, snapshot(unit))
    Backend.Broadcasts.entity_changed("unit-of-measurement", unit.uuid, unit.company_id, "updated")
    {:ok, Repo.preload(unit, [:created_by, :updated_by])}
  end

  defp after_update(other, _actor, _before), do: other

  defp snapshot(%UnitOfMeasurement{} = u),
    do: Map.new(@audit_fields, fn k -> {k, Map.get(u, k)} end)

  defp stringify_keys(attrs) do
    Enum.into(attrs, %{}, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end
end
