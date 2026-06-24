defmodule Backend.Comments do
  @moduledoc """
  Boundary for the polymorphic comments thread.

  One table — `comments` — serves every entity that benefits from a
  discussion timeline (vendor / purchase_order / stock_lot today,
  receipt verdicts / QC reviews / disputes when they ship). Each row
  is keyed by `(entity_type, entity_id)`; there are no per-entity
  comments tables.

  RBAC: write permission is *inherited* from the entity's edit
  permission — whoever can edit the vendor can comment on it. The
  per-entity mapping lives in `@write_perms` below; add a clause when
  you wire a new entity type.

  Read permission borrows the entity's view permission (same as the
  audit log) — the controller enforces that gate before calling
  `list_for/3`.

  Soft-delete: `delete_comment/2` rewrites the body to `[deleted]` and
  preserves the row. The original author OR an admin can delete.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.Comments.Comment
  alias Backend.RBAC
  alias Backend.Repo

  # Each entity type maps to a list of permission codes — holding ANY
  # of them grants comment-write on that entity. Mirrors the channel
  # `form_channel.ex`'s `can_edit_resource?/2` clauses; the two should
  # stay aligned so the UI never lets a viewer attempt a write the
  # API will reject.
  @write_perms %{
    "vendor" => ["vendors.edit", "vendors.create"],
    "customer" => ["customers.edit", "customers.create"],
    "pricelist" => ["pricelists.edit", "pricelists.create"],
    "purchase_order" => ["procurement.po_create"],
    "stock_lot" => ["stock.edit", "stock.receive"],
    "purchase_order_line" => ["procurement.po_create"],
    "bom" => ["production.bom_edit", "production.bom_create"],
    "workstation_group" => [
      "production.workstation_group_edit",
      "production.workstation_group_create"
    ],
    "workstation" => [
      "production.workstation_edit",
      "production.workstation_create"
    ],
    "routing" => [
      "production.routing_edit",
      "production.routing_create"
    ],
    "manufacturing_order" => [
      "production.mo_edit",
      "production.mo_create"
    ],
    "manufacturing_order_step" => [
      "production.mo_edit",
      "production.mo_execute"
    ]
  }

  @entity_types Map.keys(@write_perms)

  @doc "Allowed entity types — the controllers + channel check this."
  def entity_types, do: @entity_types

  # ----- list ------------------------------------------------------

  @doc """
  Paginated timeline for one entity. Returns `{items, next_cursor}` —
  shape compatible with the rest of the list endpoints, but the FE
  generally pulls the full timeline (counts on real-world entities are
  in the low hundreds at most).

  Order is `inserted_at ASC` so the UI can append new comments at the
  end of its current view without re-sorting. Soft-deleted rows stay
  in the list (body is replaced by the marker) so the audit trail
  reads chronologically.
  """
  def list_for(company_id, entity_type, entity_id, opts \\ [])
      when is_integer(company_id) and is_binary(entity_type) and is_integer(entity_id) do
    limit = clamp_limit(Keyword.get(opts, :limit))

    Repo.all(
      from(c in Comment,
        where:
          c.company_id == ^company_id and
            c.entity_type == ^entity_type and
            c.entity_id == ^entity_id,
        order_by: [asc: c.inserted_at, asc: c.id],
        preload: [:author],
        limit: ^limit
      )
    )
  end

  @doc "Quick count for the thread header ('Discussion — N comments')."
  def count_for(company_id, entity_type, entity_id)
      when is_integer(company_id) and is_binary(entity_type) and is_integer(entity_id) do
    Repo.aggregate(
      from(c in Comment,
        where:
          c.company_id == ^company_id and
            c.entity_type == ^entity_type and
            c.entity_id == ^entity_id
      ),
      :count,
      :id
    )
  end

  # ----- get -------------------------------------------------------

  @doc "Lookup by uuid + scope. Cross-tenant ids return nil."
  def get_for_company(company_id, uuid) when is_integer(company_id) and is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from(c in Comment,
            where: c.company_id == ^company_id and c.uuid == ^cast,
            preload: [:author]
          )
        )

      :error ->
        nil
    end
  end

  def get_for_company(_, _), do: nil

  # ----- create / update / delete ----------------------------------

  @doc """
  Create a comment. Caller is responsible for resolving the
  entity_id from the URL uuid + verifying the entity actually
  exists (which is a per-entity concern, not ours).

  Audit row is written with entity_type `"comment"` carrying the
  `(entity_type, entity_id)` edge so admins can investigate without
  comments cluttering the entity's own audit feed.
  """
  def create_comment(%User{} = actor, entity_type, entity_id, attrs)
      when is_binary(entity_type) and is_integer(entity_id) do
    if entity_type not in @entity_types do
      {:error, :unknown_entity_type}
    else
      attrs =
        attrs
        |> stringify_keys()
        |> Map.merge(%{
          "entity_type" => entity_type,
          "entity_id" => entity_id,
          "company_id" => actor.company_id,
          "author_id" => actor.id
        })

      %Comment{}
      |> Comment.create_changeset(attrs)
      |> Repo.insert()
      |> case do
        {:ok, comment} ->
          comment = Repo.preload(comment, :author)
          Audit.record_created(actor, "comment", comment, comment_audit_snapshot(comment))
          {:ok, comment}

        other ->
          other
      end
    end
  end

  @doc """
  Edit an existing comment. Only the original author may edit — the
  channel + UI hide the action for everyone else, but we enforce
  server-side too in case a stale client tries.
  """
  def update_comment(%User{id: actor_id}, %Comment{author_id: author_id}, _attrs)
      when actor_id != author_id do
    {:error, :forbidden}
  end

  def update_comment(%User{} = actor, %Comment{} = comment, attrs) do
    before_state = comment_audit_snapshot(comment)

    comment
    |> Comment.update_changeset(stringify_keys(attrs))
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        updated = Repo.preload(updated, :author)
        Audit.record_updated(actor, "comment", updated, before_state, comment_audit_snapshot(updated))
        {:ok, updated}

      other ->
        other
    end
  end

  @doc """
  Soft-delete a comment. The original author OR an admin may delete.
  Rewrites the body to `[deleted]` — the row stays so authorship +
  the entity edge remain auditable.
  """
  def delete_comment(%User{} = actor, %Comment{} = comment) do
    if can_delete?(actor, comment) do
      before_state = comment_audit_snapshot(comment)

      comment
      |> Comment.delete_changeset()
      |> Repo.update()
      |> case do
        {:ok, updated} ->
          updated = Repo.preload(updated, :author)
          Audit.record_updated(actor, "comment", updated, before_state, comment_audit_snapshot(updated))
          {:ok, updated}

        other ->
          other
      end
    else
      {:error, :forbidden}
    end
  end

  defp can_delete?(%User{is_admin: true}, _), do: true
  defp can_delete?(%User{id: id}, %Comment{author_id: id}), do: true
  defp can_delete?(_, _), do: false

  # ----- RBAC helpers ----------------------------------------------

  @doc """
  Can this user post / edit / delete on this entity's thread?
  Inherited from the entity's edit permission via `@write_perms`.

  Returns `true` when the user holds ANY of the listed permission
  codes (or is an admin). False for unknown entity types so the API
  fails closed.
  """
  def can_comment_on?(%User{is_admin: true}, _entity_type), do: true

  def can_comment_on?(%User{} = user, entity_type) when is_binary(entity_type) do
    case Map.get(@write_perms, entity_type) do
      nil -> false
      codes -> Enum.any?(codes, &RBAC.has_permission?(user, &1))
    end
  end

  def can_comment_on?(_, _), do: false

  @doc "Permission codes guarding comment writes on the given entity type."
  def write_permissions_for(entity_type) when is_binary(entity_type),
    do: Map.get(@write_perms, entity_type, [])

  # ----- internals -------------------------------------------------

  # Soft cap on a single thread fetch. Real-world threads are tiny
  # (< 100 messages) but a malicious client shouldn't be able to ask
  # for 10k rows at once.
  @max_limit 200

  defp clamp_limit(nil), do: @max_limit
  defp clamp_limit(n) when is_integer(n) and n > 0 and n <= @max_limit, do: n
  defp clamp_limit(n) when is_integer(n) and n > @max_limit, do: @max_limit
  defp clamp_limit(n) when is_binary(n) do
    case Integer.parse(n) do
      {parsed, ""} -> clamp_limit(parsed)
      _ -> @max_limit
    end
  end

  defp clamp_limit(_), do: @max_limit

  defp comment_audit_snapshot(%Comment{} = c) do
    %{
      entity_type: c.entity_type,
      entity_id: c.entity_id,
      body: c.body,
      visibility: c.visibility,
      author_id: c.author_id,
      parent_comment_id: c.parent_comment_id,
      edited_at: c.edited_at
    }
  end

  defp stringify_keys(attrs) when is_map(attrs) do
    Map.new(attrs, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end

  defp stringify_keys(other), do: other
end
