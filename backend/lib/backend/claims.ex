defmodule Backend.Claims do
  @moduledoc """
  Read-only access to the regulator claim register. Lookup, list with
  optional category / nutrient / jurisdiction filters. Seeded by a
  follow-up data migration.
  """

  import Ecto.Query, warn: false
  alias Backend.Claims.Claim
  alias Backend.ListQueries
  alias Backend.Repo

  @sortable_fields ~w(id claim_code claim_text category nutrient_substance status inserted_at)a
  @search_fields ~w(claim_code claim_text nutrient_substance conditions_of_use)a
  @default_sort {:nutrient_substance, :asc}

  def list_page(opts \\ []) do
    sort = Keyword.get(opts, :sort, @default_sort)

    base =
      Claim
      |> maybe_filter(opts[:category], :category)
      |> maybe_filter(opts[:status], :status)
      |> maybe_filter(opts[:source], :source)
      |> maybe_filter(opts[:nutrient_substance], :nutrient_substance)
      |> ListQueries.apply_search(opts[:search], @search_fields)
      |> ListQueries.apply_sort(sort, @sortable_fields, @default_sort)

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp maybe_filter(query, nil, _field), do: query

  defp maybe_filter(query, value, field) when is_binary(value) do
    where(query, [c], field(c, ^field) == ^value)
  end

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

  def get_by_uuid(uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} -> Repo.one(from(c in Claim, where: c.uuid == ^cast))
      :error -> nil
    end
  end

  def get_by_uuid(_), do: nil

  def get_by_uuids(uuids) when is_list(uuids) do
    cast =
      uuids
      |> Enum.map(&Ecto.UUID.cast/1)
      |> Enum.flat_map(fn
        {:ok, u} -> [u]
        :error -> []
      end)

    Repo.all(from(c in Claim, where: c.uuid in ^cast))
  end
end
