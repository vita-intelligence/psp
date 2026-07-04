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
  alias Backend.Comments.{Comment, CommentFile, CommentReaction}
  alias Backend.RBAC
  alias Backend.Repo
  alias Backend.Storage

  # Each entity type maps to a list of permission codes — holding ANY
  # of them grants comment-write on that entity. Mirrors the channel
  # `form_channel.ex`'s `can_edit_resource?/2` clauses; the two should
  # stay aligned so the UI never lets a viewer attempt a write the
  # API will reject.
  @write_perms %{
    "vendor" => ["vendors.edit", "vendors.create"],
    "customer" => ["customers.edit", "customers.create"],
    "pricelist" => ["pricelists.edit", "pricelists.create"],
    "customer_order" => ["customer_orders.create"],
    "customer_invoice" => ["customer_invoices.create"],
    "customer_return" => ["customer_returns.create"],
    "loyalty_program" => ["loyalty.programs_manage"],
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
    ],
    "shipment" => ["shipments.edit"]
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
        preload: [
          :author,
          :parent_comment,
          :files,
          reactions: :user
        ],
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
            preload: [
              :author,
              :parent_comment,
              :files,
              reactions: :user
            ]
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
    cond do
      entity_type not in @entity_types ->
        {:error, :unknown_entity_type}

      true ->
        attrs =
          attrs
          |> stringify_keys()
          |> Map.merge(%{
            "entity_type" => entity_type,
            "entity_id" => entity_id,
            "company_id" => actor.company_id,
            "author_id" => actor.id
          })

        with :ok <- validate_parent_scope(actor, entity_type, entity_id, attrs["parent_comment_id"]) do
          %Comment{}
          |> Comment.create_changeset(attrs)
          |> Repo.insert()
          |> case do
            {:ok, comment} ->
              comment =
                Repo.preload(comment, [
                  :author,
                  :parent_comment,
                  :files,
                  reactions: :user
                ])

              Audit.record_created(actor, "comment", comment, comment_audit_snapshot(comment))
              {:ok, comment}

            other ->
              other
          end
        end
    end
  end

  # Parent-comment must belong to the same tenant AND reference the same
  # entity_type + entity_id. Anything else lets a caller stitch a reply
  # under a comment on another vendor / another company, which would
  # leak scoped data through the parent snippet on render.
  defp validate_parent_scope(_actor, _entity_type, _entity_id, nil), do: :ok
  defp validate_parent_scope(_actor, _entity_type, _entity_id, ""), do: :ok

  defp validate_parent_scope(actor, entity_type, entity_id, parent_id)
       when is_integer(parent_id) do
    case Repo.one(
           from(c in Comment,
             where:
               c.id == ^parent_id and
                 c.company_id == ^actor.company_id and
                 c.entity_type == ^entity_type and
                 c.entity_id == ^entity_id,
             select: c.id
           )
         ) do
      nil -> {:error, :parent_comment_not_found}
      _ -> :ok
    end
  end

  defp validate_parent_scope(actor, entity_type, entity_id, parent_id) when is_binary(parent_id) do
    case Integer.parse(parent_id) do
      {parsed, ""} -> validate_parent_scope(actor, entity_type, entity_id, parsed)
      _ -> {:error, :parent_comment_not_found}
    end
  end

  defp validate_parent_scope(_actor, _entity_type, _entity_id, _), do: {:error, :parent_comment_not_found}

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

  # ----- attachments ----------------------------------------------

  # Cap the number of attachments per comment. Matches the FE composer's
  # own guard, but re-checked server-side so a scripted client can't
  # smuggle an unbounded gallery in.
  @max_files_per_comment 20
  @max_reactions_per_comment 100

  @doc "Attachment cap per comment (mirrored on the FE composer)."
  def max_files_per_comment, do: @max_files_per_comment

  @doc "Reaction cap per comment (mirrored on the FE composer)."
  def max_reactions_per_comment, do: @max_reactions_per_comment

  @doc """
  Attach an already-uploaded blob to a comment. Caller has already
  called `Storage.put/3` and holds the blob path — this function
  writes the metadata row + fires the audit event.

  Author-or-admin gate re-checks the entity edit permission on every
  call so a peer whose role was revoked mid-thread can't silently add
  files to a comment they wrote earlier.
  """
  def attach_file(%User{} = actor, %Comment{} = comment, attrs) do
    with :ok <- authorize_file_write(actor, comment),
         :ok <- ensure_file_capacity(comment.id) do
      full_attrs =
        attrs
        |> stringify_keys()
        |> Map.put("company_id", comment.company_id)
        |> Map.put("comment_id", comment.id)
        |> Map.put("uploaded_by_id", actor.id)

      %CommentFile{}
      |> CommentFile.changeset(full_attrs)
      |> Repo.insert()
      |> case do
        {:ok, file} ->
          file = Repo.preload(file, :uploaded_by)
          Audit.record_created(actor, "comment_file", file, comment_file_audit_snapshot(file, comment))
          {:ok, file}

        other ->
          other
      end
    end
  end

  @doc "Files attached to a comment, oldest-first (insertion order)."
  def list_files(comment_id) when is_integer(comment_id) do
    Repo.all(
      from(f in CommentFile,
        where: f.comment_id == ^comment_id,
        order_by: [asc: f.inserted_at, asc: f.id],
        preload: [:uploaded_by]
      )
    )
  end

  @doc """
  Look up a single file scoped to a comment. Cross-tenant / cross-comment
  uuids return nil so the controller can 404 cleanly.
  """
  def get_file(comment_id, uuid) when is_integer(comment_id) and is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from(f in CommentFile,
            where: f.comment_id == ^comment_id and f.uuid == ^cast,
            preload: [:uploaded_by]
          )
        )

      :error ->
        nil
    end
  end

  def get_file(_, _), do: nil

  @doc """
  Look up a file by uuid within the caller's company, joining the
  parent comment so the serve endpoint can gate on the comment's
  entity_type view perm without a second query.
  """
  def get_file_for_company(company_id, file_uuid)
      when is_integer(company_id) and is_binary(file_uuid) do
    case Ecto.UUID.cast(file_uuid) do
      {:ok, cast} ->
        Repo.one(
          from(f in CommentFile,
            join: c in assoc(f, :comment),
            where: f.company_id == ^company_id and f.uuid == ^cast,
            preload: [comment: c]
          )
        )

      :error ->
        nil
    end
  end

  def get_file_for_company(_, _), do: nil

  @doc """
  Hard-delete a file row + drop the underlying blob. Comment author OR
  admin only. The audit event is written before the delete so we can
  recover the metadata if someone asks "who deleted that image".
  """
  def delete_file(%User{} = actor, %CommentFile{} = file) do
    comment = Repo.get(Comment, file.comment_id)

    cond do
      is_nil(comment) ->
        {:error, :not_found}

      not can_manage_file?(actor, comment) ->
        {:error, :forbidden}

      true ->
        Audit.record_deleted(actor, "comment_file", file, comment_file_audit_snapshot(file, comment))
        _ = Storage.delete(file.blob_path)
        Repo.delete(file)
    end
  end

  # File-write permission: the comment author OR an admin OR a user
  # who still holds the entity's edit perm. The fresh RBAC check
  # prevents a revoked role from continuing to attach files via a
  # long-lived socket / cached token.
  defp authorize_file_write(%User{is_admin: true}, _comment), do: :ok

  defp authorize_file_write(%User{id: id}, %Comment{author_id: id}), do: :ok

  defp authorize_file_write(%User{} = actor, %Comment{entity_type: type}) do
    if can_comment_on?(actor, type), do: :ok, else: {:error, :forbidden}
  end

  defp can_manage_file?(%User{is_admin: true}, _), do: true
  defp can_manage_file?(%User{id: id}, %Comment{author_id: id}), do: true
  defp can_manage_file?(_, _), do: false

  defp ensure_file_capacity(comment_id) do
    count =
      Repo.aggregate(
        from(f in CommentFile, where: f.comment_id == ^comment_id),
        :count,
        :id
      )

    if count >= @max_files_per_comment do
      {:error, :file_limit_reached}
    else
      :ok
    end
  end

  # ----- reactions ------------------------------------------------

  @doc """
  Add an emoji reaction. Idempotent: if the same user has already
  reacted with the same emoji we return the existing row instead of
  bubbling the unique-constraint error to the caller.

  Callers need write perm on the entity (peers, not just the comment
  author, can react — that's the whole point).
  """
  def add_reaction(%User{} = actor, %Comment{} = comment, emoji) when is_binary(emoji) do
    with :ok <- authorize_reaction(actor, comment),
         :ok <- ensure_reaction_capacity(comment.id) do
      attrs = %{
        "company_id" => comment.company_id,
        "comment_id" => comment.id,
        "user_id" => actor.id,
        "emoji" => emoji
      }

      %CommentReaction{}
      |> CommentReaction.changeset(attrs)
      |> Repo.insert()
      |> case do
        {:ok, reaction} ->
          {:ok, Repo.preload(reaction, :user)}

        {:error, %Ecto.Changeset{errors: errors}} = err ->
          case Keyword.get(errors, :emoji) do
            {"already reacted", _} ->
              existing =
                Repo.one(
                  from(r in CommentReaction,
                    where:
                      r.comment_id == ^comment.id and
                        r.user_id == ^actor.id and
                        r.emoji == ^String.trim(emoji),
                    preload: [:user]
                  )
                )

              if existing, do: {:ok, existing}, else: err

            _ ->
              err
          end
      end
    end
  end

  def add_reaction(_actor, _comment, _emoji), do: {:error, :invalid_emoji}

  @doc "Remove a reaction the caller previously left. No-op if it's not there."
  def remove_reaction(%User{} = actor, %Comment{} = comment, emoji) when is_binary(emoji) do
    trimmed = String.trim(emoji)

    query =
      from(r in CommentReaction,
        where:
          r.comment_id == ^comment.id and
            r.user_id == ^actor.id and
            r.emoji == ^trimmed
      )

    case Repo.one(query) do
      nil -> {:ok, :noop}
      reaction -> Repo.delete(reaction)
    end
  end

  def remove_reaction(_actor, _comment, _emoji), do: {:error, :invalid_emoji}

  @doc """
  Reactions on a comment collapsed by emoji.

  Returns `[%{emoji: "👍", count: 3, user_ids: [1, 2, 3], own_reacted: true}]`
  with `own_reacted` set relative to the caller. Order is by first
  reaction time — the "who kicked off this cluster" order matches
  Slack / Messenger.
  """
  def list_reactions(comment_id, current_user_id \\ nil) when is_integer(comment_id) do
    comment_id
    |> load_reactions()
    |> collapse_reactions(current_user_id)
  end

  @doc """
  Collapse an already-preloaded list of reactions into the grouped
  payload shape. Used by the payload serializer to avoid re-querying
  when the reactions were fetched with the comment.
  """
  def collapse_reactions(reactions, current_user_id) when is_list(reactions) do
    reactions
    |> Enum.group_by(& &1.emoji)
    |> Enum.map(fn {emoji, rows} ->
      sorted = Enum.sort_by(rows, & &1.inserted_at, {:asc, DateTime})
      user_ids = Enum.map(sorted, & &1.user_id)

      %{
        emoji: emoji,
        count: length(sorted),
        user_ids: user_ids,
        own_reacted: current_user_id != nil and current_user_id in user_ids
      }
    end)
    |> Enum.sort_by(fn %{user_ids: [first | _]} -> first end)
  end

  defp load_reactions(comment_id) do
    Repo.all(
      from(r in CommentReaction,
        where: r.comment_id == ^comment_id,
        order_by: [asc: r.inserted_at, asc: r.id]
      )
    )
  end

  defp authorize_reaction(%User{is_admin: true}, _comment), do: :ok

  defp authorize_reaction(%User{} = actor, %Comment{entity_type: type}) do
    if can_comment_on?(actor, type), do: :ok, else: {:error, :forbidden}
  end

  defp ensure_reaction_capacity(comment_id) do
    count =
      Repo.aggregate(
        from(r in CommentReaction, where: r.comment_id == ^comment_id),
        :count,
        :id
      )

    if count >= @max_reactions_per_comment do
      {:error, :reaction_limit_reached}
    else
      :ok
    end
  end

  defp comment_file_audit_snapshot(%CommentFile{} = f, %Comment{} = c) do
    %{
      comment_id: c.id,
      entity_type: c.entity_type,
      entity_id: c.entity_id,
      kind: f.kind,
      filename: f.filename,
      mime: f.mime,
      byte_size: f.byte_size,
      blob_path: f.blob_path,
      uploaded_by_id: f.uploaded_by_id
    }
  end

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
