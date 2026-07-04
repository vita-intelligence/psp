defmodule Backend.Warehouses.StorageTags do
  @moduledoc """
  Boundary for the company-scoped storage tag vocabulary. Reads
  return the active list (used by the picker); mutations are
  audit-tracked.

  Tag membership is enforced on `StorageLocation` / `StorageCell`
  writes via `validate_tag_membership/3` so a free-text keystroke
  can't smuggle in a typo.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.ListQueries
  alias Backend.Repo
  alias Backend.Warehouses.StorageTag

  @audit_fields ~w(key label description kind)a
  # `code` sorts are remapped to `:id` in normalise_sort/1 — the
  # display code is computed on the fly so id order = code order.
  @sortable_fields ~w(id key label kind inserted_at)a
  @search_fields ~w(key label description)a
  @default_sort {:label, :asc}

  ## ----- read ------------------------------------------------------

  @doc """
  Cursor-paginated list for the admin DataTable. Mirrors the
  `list_templates/2` pattern in `Backend.RBAC` so the same shape
  (`{items, next_cursor}`) flows through the reusable table component.
  """
  def list_page(company_id, opts \\ []) do
    sort = normalise_sort(Keyword.get(opts, :sort, @default_sort))

    base =
      StorageTag
      |> where([t], t.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @search_fields)
      |> ListQueries.apply_column_filters(opts[:column_filter], @sortable_fields)
      |> ListQueries.apply_sort(sort, @sortable_fields, @default_sort)
      |> preload([:created_by, :updated_by])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp normalise_sort({:code, dir}), do: {:id, dir}
  defp normalise_sort(other), do: other

  @doc "Static config used by the FE table controls."
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
      from(t in StorageTag,
        where: t.company_id == ^company_id,
        order_by: [asc: t.label, asc: t.key],
        preload: [:created_by, :updated_by]
      )

    case Keyword.get(opts, :kind) do
      nil ->
        Repo.all(base)

      kind when is_binary(kind) ->
        Repo.all(
          from(t in base,
            where: t.kind == ^kind or t.kind == "both"
          )
        )
    end
  end

  def get_for_company(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from(t in StorageTag,
            where: t.company_id == ^company_id and t.uuid == ^cast,
            preload: [:created_by, :updated_by]
          )
        )

      :error ->
        nil
    end
  end

  def get_for_company(_company_id, _), do: nil

  @doc """
  Set of valid tag keys for the company. Used to whitelist arrays on
  StorageLocation + StorageCell writes — see `validate_tag_membership/3`.
  """
  def known_keys_for_company(company_id) do
    Repo.all(
      from(t in StorageTag,
        where: t.company_id == ^company_id,
        select: t.key
      )
    )
    |> MapSet.new()
  end

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

    %StorageTag{}
    |> StorageTag.changeset(attrs)
    |> Repo.insert()
    |> after_create(actor)
  end

  def update(%User{} = actor, %StorageTag{} = tag, attrs) do
    before_state = snapshot(tag)

    tag
    |> StorageTag.changeset(
      attrs
      |> stringify_keys()
      |> Map.put("updated_by_id", actor.id)
    )
    |> Repo.update()
    |> after_update(actor, before_state)
  end

  def delete(%User{} = actor, %StorageTag{} = tag) do
    before_state = snapshot(tag)

    case Repo.delete(tag) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "storage_tag", tag, before_state)
        {:ok, deleted}

      other ->
        other
    end
  end

  ## ----- helpers ---------------------------------------------------

  @doc """
  Ecto changeset validator: reject a `tags` array that contains any
  key not present in the company's storage_tags. Pass the company id
  so the lookup is scoped correctly.

      changeset
      |> StorageTags.validate_tag_membership(:tags, company_id)
  """
  def validate_tag_membership(changeset, field, company_id)
      when is_atom(field) and is_integer(company_id) do
    case Ecto.Changeset.get_field(changeset, field) do
      list when is_list(list) and list != [] ->
        known = known_keys_for_company(company_id)

        unknown =
          list
          |> Enum.map(&to_string/1)
          |> Enum.reject(&MapSet.member?(known, &1))

        case unknown do
          [] ->
            changeset

          [_ | _] ->
            Ecto.Changeset.add_error(
              changeset,
              field,
              "unknown tag(s): #{Enum.join(unknown, ", ")} — define them at /settings/storage-tags first"
            )
        end

      _ ->
        changeset
    end
  end

  def validate_tag_membership(changeset, _field, _company_id), do: changeset

  defp after_create({:ok, tag}, actor) do
    Audit.record_created(actor, "storage_tag", tag, snapshot(tag))
    {:ok, Repo.preload(tag, [:created_by, :updated_by])}
  end

  defp after_create(other, _actor), do: other

  defp after_update({:ok, tag}, actor, before_state) do
    Audit.record_updated(actor, "storage_tag", tag, before_state, snapshot(tag))
    {:ok, Repo.preload(tag, [:created_by, :updated_by])}
  end

  defp after_update(other, _actor, _before), do: other

  defp snapshot(%StorageTag{} = t),
    do: Map.new(@audit_fields, fn k -> {k, Map.get(t, k)} end)

  defp stringify_keys(attrs) do
    Enum.into(attrs, %{}, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end
end
