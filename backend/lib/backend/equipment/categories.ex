defmodule Backend.Equipment.Categories do
  @moduledoc """
  Boundary for equipment-category CRUD. Categories are tenant-
  scoped and unique-named per tenant. Inactive categories still
  render on existing equipment (via the FK) but are hidden from
  new-equipment pickers.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Equipment.Category
  alias Backend.Repo

  def list_for_company(company_id) when is_integer(company_id) do
    Category
    |> where([c], c.company_id == ^company_id)
    |> order_by([c], desc: c.is_active, asc: :name)
    |> Repo.all()
  end

  def list_active_for_company(company_id) when is_integer(company_id) do
    Category
    |> where([c], c.company_id == ^company_id and c.is_active == true)
    |> order_by([c], asc: :name)
    |> Repo.all()
  end

  def get_for_company(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Category
        |> where([c], c.company_id == ^company_id and c.uuid == ^cast)
        |> Repo.one()

      _ ->
        nil
    end
  end

  def create(company_id, attrs, %User{} = actor) do
    attrs =
      attrs
      |> Map.put("company_id", company_id)
      |> Map.put("created_by_id", actor.id)
      |> Map.put("updated_by_id", actor.id)

    %Category{}
    |> Category.changeset(attrs)
    |> Repo.insert()
  end

  def update(%Category{} = cat, attrs, %User{} = actor) do
    attrs =
      attrs
      |> Map.drop(["company_id", "created_by_id"])
      |> Map.put("updated_by_id", actor.id)

    cat
    |> Category.changeset(attrs)
    |> Repo.update()
  end

  def deactivate(%Category{} = cat, %User{} = actor) do
    cat
    |> Category.changeset(%{"is_active" => false, "updated_by_id" => actor.id})
    |> Repo.update()
  end
end
