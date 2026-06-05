defmodule Backend.Allergens do
  @moduledoc """
  Read-only access to the EU FIC Annex II allergen lookup. Seeded by
  migration; never mutated at runtime.
  """

  import Ecto.Query, warn: false
  alias Backend.Allergens.Allergen
  alias Backend.Repo

  def list_all do
    Repo.all(from(a in Allergen, order_by: [asc: a.sort_order, asc: a.label]))
  end

  def get_by_uuid(uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} -> Repo.one(from(a in Allergen, where: a.uuid == ^cast))
      :error -> nil
    end
  end

  def get_by_uuid(_), do: nil

  def get_by_keys(keys) when is_list(keys) do
    Repo.all(from(a in Allergen, where: a.key in ^keys))
  end
end
