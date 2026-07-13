defmodule Backend.Catalogs do
  @moduledoc """
  Boundary for product families + attribute definitions. Both are
  catalogue-shape entities: per-company, named, indexed for picker
  lookups. The standing PSP list-page pattern (cursor + search +
  sort) applies to both.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.Catalogs.{AttributeDefinition, ProductFamily}
  alias Backend.ListQueries
  alias Backend.Repo

  # ----- product families ------------------------------------------

  @family_audit_fields ~w(name description is_active)a
  @family_sortable ~w(id name description is_active inserted_at updated_at)a
  @family_search ~w(name description)a
  @family_default_sort {:name, :asc}

  def list_families_page(company_id, opts \\ []) do
    sort = normalise_sort(Keyword.get(opts, :sort, @family_default_sort))

    {code_id, column_filter} =
      ListQueries.pop_code_column_filter(opts[:column_filter], company_id, "product_family")

    base =
      ProductFamily
      |> where([f], f.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @family_search, {company_id, "product_family"})
      |> maybe_family_code_id_filter(code_id)
      |> ListQueries.apply_column_filters(column_filter, @family_sortable)
      |> ListQueries.apply_sort(sort, @family_sortable, @family_default_sort)
      |> preload([:created_by, :updated_by])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp maybe_family_code_id_filter(query, nil), do: query
  defp maybe_family_code_id_filter(query, :no_match), do: where(query, [f], false)
  defp maybe_family_code_id_filter(query, id) when is_integer(id),
    do: where(query, [f], f.id == ^id)

  def list_families_for_company(company_id) do
    Repo.all(
      from(f in ProductFamily,
        where: f.company_id == ^company_id and f.is_active == true,
        order_by: [asc: f.name]
      )
    )
  end

  def family_list_config do
    %{
      sortable_fields: Enum.map(@family_sortable, &Atom.to_string/1),
      search_fields: Enum.map(@family_search, &Atom.to_string/1),
      default_sort: %{
        field: Atom.to_string(elem(@family_default_sort, 0)),
        direction: Atom.to_string(elem(@family_default_sort, 1))
      }
    }
  end

  def get_family_for_company(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from(f in ProductFamily,
            where: f.company_id == ^company_id and f.uuid == ^cast,
            preload: [:created_by, :updated_by]
          )
        )

      :error ->
        nil
    end
  end

  def get_family_for_company(_company_id, _), do: nil

  def create_family(%User{} = actor, company_id, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "company_id" => company_id,
        "created_by_id" => actor.id,
        "updated_by_id" => actor.id
      })

    %ProductFamily{}
    |> ProductFamily.changeset(attrs)
    |> Repo.insert()
    |> after_family_create(actor)
  end

  def update_family(%User{} = actor, %ProductFamily{} = family, attrs) do
    before_state = family_snapshot(family)

    family
    |> ProductFamily.changeset(
      attrs |> stringify_keys() |> Map.put("updated_by_id", actor.id)
    )
    |> Repo.update()
    |> after_family_update(actor, before_state)
  end

  def delete_family(%User{} = actor, %ProductFamily{} = family) do
    before_state = family_snapshot(family)

    case Repo.delete(family) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "product_family", family, before_state)
        Backend.Broadcasts.entity_changed("product-family", family.uuid, family.company_id, "deleted")
        {:ok, deleted}

      other ->
        other
    end
  end

  defp after_family_create({:ok, family}, actor) do
    Audit.record_created(actor, "product_family", family, family_snapshot(family))
    Backend.Broadcasts.entity_changed("product-family", family.uuid, family.company_id, "created")
    {:ok, Repo.preload(family, [:created_by, :updated_by])}
  end

  defp after_family_create(other, _actor), do: other

  defp after_family_update({:ok, family}, actor, before_state) do
    Audit.record_updated(actor, "product_family", family, before_state, family_snapshot(family))
    Backend.Broadcasts.entity_changed("product-family", family.uuid, family.company_id, "updated")
    {:ok, Repo.preload(family, [:created_by, :updated_by])}
  end

  defp after_family_update(other, _actor, _before), do: other

  defp family_snapshot(%ProductFamily{} = f),
    do: Map.new(@family_audit_fields, fn k -> {k, Map.get(f, k)} end)

  # ----- attribute definitions -------------------------------------

  @attr_audit_fields ~w(scope key label attribute_type enum_choices required default_value unit_symbol help_text sort_order is_active)a
  @attr_sortable ~w(id scope key label attribute_type required sort_order is_active inserted_at updated_at)a
  @attr_search ~w(key label help_text)a
  @attr_default_sort {:sort_order, :asc}

  def list_attribute_definitions_page(company_id, opts \\ []) do
    sort = normalise_sort(Keyword.get(opts, :sort, @attr_default_sort))
    scope_filter = opts[:scope]

    {code_id, column_filter} =
      ListQueries.pop_code_column_filter(opts[:column_filter], company_id, "attribute_definition")

    base =
      AttributeDefinition
      |> where([a], a.company_id == ^company_id)
      |> maybe_scope_filter(scope_filter)
      |> ListQueries.apply_search(opts[:search], @attr_search, {company_id, "attribute_definition"})
      |> maybe_attr_code_id_filter(code_id)
      |> ListQueries.apply_column_filters(column_filter, @attr_sortable)
      |> ListQueries.apply_sort(sort, @attr_sortable, @attr_default_sort)
      |> preload([:created_by, :updated_by])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp maybe_attr_code_id_filter(query, nil), do: query
  defp maybe_attr_code_id_filter(query, :no_match), do: where(query, [a], false)
  defp maybe_attr_code_id_filter(query, id) when is_integer(id),
    do: where(query, [a], a.id == ^id)

  defp maybe_scope_filter(query, nil), do: query

  defp maybe_scope_filter(query, scope) when is_binary(scope) do
    where(query, [a], a.scope == ^scope)
  end

  def attribute_list_config do
    %{
      sortable_fields: Enum.map(@attr_sortable, &Atom.to_string/1),
      search_fields: Enum.map(@attr_search, &Atom.to_string/1),
      default_sort: %{
        field: Atom.to_string(elem(@attr_default_sort, 0)),
        direction: Atom.to_string(elem(@attr_default_sort, 1))
      }
    }
  end

  @doc """
  Active attribute definitions for one scope. Used by the items
  context to validate `attributes` JSONB writes and by the FE form
  to render the dynamic input rows.
  """
  def active_attribute_definitions_for_scope(company_id, scope) when is_binary(scope) do
    Repo.all(
      from(a in AttributeDefinition,
        where:
          a.company_id == ^company_id and a.is_active == true and
            (a.scope == ^scope or a.scope == "item_any"),
        order_by: [asc: a.sort_order, asc: a.key]
      )
    )
  end

  def get_attribute_definition_for_company(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from(a in AttributeDefinition,
            where: a.company_id == ^company_id and a.uuid == ^cast,
            preload: [:created_by, :updated_by]
          )
        )

      :error ->
        nil
    end
  end

  def get_attribute_definition_for_company(_company_id, _), do: nil

  def create_attribute_definition(%User{} = actor, company_id, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "company_id" => company_id,
        "created_by_id" => actor.id,
        "updated_by_id" => actor.id
      })

    %AttributeDefinition{}
    |> AttributeDefinition.changeset(attrs)
    |> Repo.insert()
    |> after_attr_create(actor)
  end

  def update_attribute_definition(
        %User{} = actor,
        %AttributeDefinition{} = def_,
        attrs
      ) do
    before_state = attr_snapshot(def_)

    def_
    |> AttributeDefinition.changeset(
      attrs |> stringify_keys() |> Map.put("updated_by_id", actor.id)
    )
    |> Repo.update()
    |> after_attr_update(actor, before_state)
  end

  def delete_attribute_definition(%User{} = actor, %AttributeDefinition{} = def_) do
    before_state = attr_snapshot(def_)

    case Repo.delete(def_) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "attribute_definition", def_, before_state)
        Backend.Broadcasts.entity_changed("attribute-definition", def_.uuid, def_.company_id, "deleted")
        {:ok, deleted}

      other ->
        other
    end
  end

  defp after_attr_create({:ok, def_}, actor) do
    Audit.record_created(actor, "attribute_definition", def_, attr_snapshot(def_))
    Backend.Broadcasts.entity_changed("attribute-definition", def_.uuid, def_.company_id, "created")
    {:ok, Repo.preload(def_, [:created_by, :updated_by])}
  end

  defp after_attr_create(other, _actor), do: other

  defp after_attr_update({:ok, def_}, actor, before_state) do
    Audit.record_updated(actor, "attribute_definition", def_, before_state, attr_snapshot(def_))
    Backend.Broadcasts.entity_changed("attribute-definition", def_.uuid, def_.company_id, "updated")
    {:ok, Repo.preload(def_, [:created_by, :updated_by])}
  end

  defp after_attr_update(other, _actor, _before), do: other

  defp attr_snapshot(%AttributeDefinition{} = a),
    do: Map.new(@attr_audit_fields, fn k -> {k, Map.get(a, k)} end)

  # ----- shared ----------------------------------------------------

  defp normalise_sort({:code, dir}), do: {:id, dir}
  defp normalise_sort(other), do: other

  defp stringify_keys(attrs) do
    Enum.into(attrs, %{}, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end
end
