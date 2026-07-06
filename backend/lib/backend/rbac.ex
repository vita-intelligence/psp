defmodule Backend.RBAC do
  @moduledoc """
  Boundary for role-based access control: permission checks +
  permission-template CRUD.

  Access is per-user (`User.is_admin` short-circuits every check;
  `User.permissions[]` is the otherwise-authoritative grant set). The
  `roles` table is repurposed as the home of admin-defined
  **permission templates** — saved permission-code bundles that admins
  can apply to a user with one click. Applying just unions the codes
  into the user's `permissions` array; there is no persistent link
  between user and template.
  """

  import Ecto.Query, warn: false

  alias Backend.Audit
  alias Backend.Repo
  alias Backend.Accounts.User
  alias Backend.ListQueries
  alias Backend.RBAC.{Role, Permissions}

  # Auditable surface for templates — what the history view actually
  # shows. Excludes bookkeeping columns.
  @template_audit_fields ~w(name description permissions)a

  # `code` sorts are remapped to `:id` in normalise_sort/1 — the
  # display code is computed on the fly so id order = code order.
  @sortable_fields ~w(id name description is_system inserted_at updated_at)a
  @search_fields ~w(name description)a
  @default_sort {:name, :asc}

  ## Permission checks -------------------------------------------------

  @doc """
  Returns the deduped, sorted permission codes for the user.
  `is_admin` short-circuits to the full registry; otherwise the
  user's direct `permissions` array is the source of truth.
  """
  def effective_permissions(%User{is_admin: true}), do: Permissions.all()

  def effective_permissions(%User{permissions: perms}) when is_list(perms) do
    perms |> Enum.uniq() |> Enum.sort()
  end

  def effective_permissions(_), do: []

  @doc """
  True if the user has the given permission. `is_admin` bypasses every
  check; otherwise the code must be in the user's `permissions` array.
  """
  def has_permission?(nil, _), do: false
  def has_permission?(%User{is_admin: true}, _), do: true

  def has_permission?(%User{permissions: perms}, code)
      when is_list(perms) and is_binary(code) do
    code in perms
  end

  def has_permission?(_, _), do: false

  ## Template lookups --------------------------------------------------

  @doc """
  Lookup a template by its public UUID. Path-param string in, Role
  struct out (or nil for unknown / malformed UUIDs).
  """
  def get_template(uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Role
        |> Repo.get_by(uuid: cast)
        |> case do
          nil -> nil
          tpl -> Repo.preload(tpl, [:created_by, :updated_by])
        end

      :error ->
        nil
    end
  end

  def get_template(_), do: nil

  @doc """
  Paginated/sortable/searchable templates list. Same `{items,
  next_cursor}` shape every list endpoint produces, so the frontend
  DataTable that drives Warehouses and Users drives this too. Opts
  match `Backend.ListQueries` semantics — sortable on `name` /
  `inserted_at`, search ILIKEs across name and description.
  """
  def list_templates(company_id, opts \\ []) do
    sort = normalise_sort(Keyword.get(opts, :sort, @default_sort))

    base =
      Role
      |> where([r], r.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @search_fields)
      |> ListQueries.apply_column_filters(opts[:column_filter], @sortable_fields)
      |> ListQueries.apply_sort(sort, @sortable_fields, @default_sort)
      |> preload([:created_by, :updated_by])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp normalise_sort({:code, dir}), do: {:id, dir}
  defp normalise_sort(other), do: other

  @doc "Static config the frontend reads to drive its column controls."
  def list_templates_config do
    %{
      sortable_fields: Enum.map(@sortable_fields, &Atom.to_string/1),
      search_fields: Enum.map(@search_fields, &Atom.to_string/1),
      default_sort: %{
        field: Atom.to_string(elem(@default_sort, 0)),
        direction: Atom.to_string(elem(@default_sort, 1))
      }
    }
  end

  ## Template mutations ------------------------------------------------

  @doc """
  Create a permission template in the actor's company. `name` is
  required; `slug` is derived from name if not supplied. Permission
  codes are validated against `Permissions.valid?/1` — unknowns
  surface as a changeset error so the form can highlight them.
  """
  def create_template(%User{} = actor, attrs) do
    attrs =
      attrs
      |> normalize_template_attrs()
      |> Map.merge(%{
        "company_id" => actor.company_id,
        "created_by_id" => actor.id,
        "updated_by_id" => actor.id
      })

    %Role{}
    |> Role.changeset(attrs)
    |> Repo.insert()
    |> after_template_create(actor)
  end

  @doc """
  Update a template. Refuses to touch a `is_system: true` row — those
  are reserved for future demo/starter templates and shouldn't be
  edited from the UI.
  """
  def update_template(_actor, %Role{is_system: true}, _attrs),
    do: {:error, :system_template}

  def update_template(%User{} = actor, %Role{} = template, attrs) do
    before_state = template_audit_snapshot(template)

    template
    |> Role.changeset(
      attrs
      |> normalize_template_attrs()
      |> Map.put("updated_by_id", actor.id)
    )
    |> Repo.update()
    |> after_template_update(actor, before_state)
  end

  def delete_template(_actor, %Role{is_system: true}), do: {:error, :system_template}

  def delete_template(%User{} = actor, %Role{} = template) do
    before_state = template_audit_snapshot(template)

    case Repo.delete(template) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "template", template, before_state)
        Backend.Broadcasts.entity_changed("role", template.uuid, template.company_id, "deleted")
        {:ok, deleted}

      other ->
        other
    end
  end

  defp after_template_create({:ok, template}, actor) do
    Audit.record_created(actor, "template", template, template_audit_snapshot(template))
    Backend.Broadcasts.entity_changed("role", template.uuid, template.company_id, "created")
    {:ok, Repo.preload(template, [:created_by, :updated_by])}
  end

  defp after_template_create(other, _actor), do: other

  defp after_template_update({:ok, template}, actor, before_state) do
    Audit.record_updated(
      actor,
      "template",
      template,
      before_state,
      template_audit_snapshot(template)
    )

    Backend.Broadcasts.entity_changed("role", template.uuid, template.company_id, "updated")
    {:ok, Repo.preload(template, [:created_by, :updated_by])}
  end

  defp after_template_update(other, _actor, _before_state), do: other

  defp template_audit_snapshot(%Role{} = t),
    do: Map.new(@template_audit_fields, fn k -> {k, Map.get(t, k)} end)

  # Slug auto-derivation — admins shouldn't have to think about URL
  # slugs. We keep the column for uniqueness + future shareable links
  # but generate from the name when one isn't supplied.
  defp normalize_template_attrs(attrs) do
    attrs = stringify_keys(attrs)

    case Map.get(attrs, "slug") do
      nil -> Map.put(attrs, "slug", slugify(Map.get(attrs, "name") || ""))
      "" -> Map.put(attrs, "slug", slugify(Map.get(attrs, "name") || ""))
      _ -> attrs
    end
  end

  defp stringify_keys(map) do
    Enum.into(map, %{}, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end

  defp slugify(name) do
    name
    |> String.downcase()
    |> String.replace(~r/[^a-z0-9]+/, "-")
    |> String.trim("-")
    |> case do
      "" -> "template-#{System.unique_integer([:positive])}"
      s -> s
    end
  end
end
