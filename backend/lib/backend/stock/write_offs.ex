defmodule Backend.Stock.WriteOffs do
  @moduledoc """
  Context for the `Backend.Stock.WriteOff` state machine.

  Every mutating call takes the acting `%User{}` so it can enforce
  the three-eyes principle (`assert_distinct_actor/2`) and stamp
  the electronic signature. The `password:` argument on
  `approve/3`, `authorise/3`, and `revert/3` is re-verified against
  the user's Bcrypt hash at the moment of the action — this is what
  gives us a Part 11-shaped signature without a separate PIN column.

  Cursor pagination + filter shape mirrors
  `Backend.Stock.list_movements/2` so the FE reuses the same
  table + fetch pattern.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.ListQueries
  alias Backend.Repo
  alias Backend.Stock.{Lot, Movement, Placement, WriteOff}

  @sortable_fields ~w(inserted_at id status qty reason_category)a
  @default_sort {:inserted_at, :desc}
  @column_filter_fields ~w(status reason_category disposal_method qty)a

  # -------------------------------------------------------------------
  # List
  # -------------------------------------------------------------------

  @doc """
  Paginated list of write-offs scoped to the company. Filter shape
  mirrors `Backend.Stock.list_movements/2` — same auditor toolset.
  """
  def list(company_id, opts \\ []) when is_integer(company_id) do
    sort = normalise_sort(Keyword.get(opts, :sort, @default_sort))

    {item_name_needle, column_filter} =
      ListQueries.pop_joined_text_filter(opts[:column_filter], "item_name")

    {lot_code_needle, column_filter} =
      ListQueries.pop_joined_text_filter(column_filter, "lot_code")

    base =
      WriteOff
      |> where([w], w.company_id == ^company_id)
      |> maybe_status_filter(opts[:status])
      |> maybe_reason_filter(opts[:reason_category])
      |> maybe_date_filter(opts[:from_at], opts[:to_at])
      |> maybe_creator_filter(opts[:created_by_id])
      |> maybe_lot_filter(opts[:stock_lot_id])
      |> maybe_search(opts[:search])
      |> maybe_item_name_filter(item_name_needle)
      |> maybe_lot_code_filter(lot_code_needle)
      |> ListQueries.apply_column_filters(column_filter, @column_filter_fields)
      |> ListQueries.apply_sort(sort, @sortable_fields, @default_sort)
      |> preload([
        :created_by,
        :approved_by,
        :authorised_by,
        :reverted_by,
        :destination_cell,
        stock_lot: [:item, :unit_of_measurement]
      ])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp normalise_sort({field, direction})
       when field in @sortable_fields and direction in [:asc, :desc],
       do: {field, direction}

  defp normalise_sort(_), do: @default_sort

  defp maybe_status_filter(query, nil), do: query
  defp maybe_status_filter(query, ""), do: query

  defp maybe_status_filter(query, status) when is_binary(status),
    do: where(query, [w], w.status == ^status)

  defp maybe_reason_filter(query, nil), do: query

  defp maybe_reason_filter(query, cat) when is_binary(cat),
    do: where(query, [w], w.reason_category == ^cat)

  defp maybe_date_filter(query, nil, nil), do: query

  defp maybe_date_filter(query, from_at, to_at) do
    query
    |> maybe_where_date(from_at, :gte)
    |> maybe_where_date(to_at, :lte)
  end

  defp maybe_where_date(query, nil, _), do: query

  defp maybe_where_date(query, %DateTime{} = dt, :gte),
    do: where(query, [w], w.inserted_at >= ^dt)

  defp maybe_where_date(query, %DateTime{} = dt, :lte),
    do: where(query, [w], w.inserted_at <= ^dt)

  defp maybe_where_date(query, iso, dir) when is_binary(iso) do
    case DateTime.from_iso8601(iso) do
      {:ok, dt, _} -> maybe_where_date(query, dt, dir)
      _ -> query
    end
  end

  defp maybe_creator_filter(query, nil), do: query

  defp maybe_creator_filter(query, id) when is_integer(id),
    do: where(query, [w], w.created_by_id == ^id)

  defp maybe_lot_filter(query, nil), do: query

  defp maybe_lot_filter(query, id) when is_integer(id),
    do: where(query, [w], w.stock_lot_id == ^id)

  defp maybe_search(query, nil), do: query
  defp maybe_search(query, ""), do: query

  defp maybe_search(query, term) when is_binary(term) do
    needle = "%" <> ListQueries.escape_like(String.trim(term)) <> "%"
    where(query, [w], ilike(w.reason_narrative, ^needle))
  end

  defp maybe_item_name_filter(query, nil), do: query

  defp maybe_item_name_filter(query, needle) when is_binary(needle) do
    like = "%" <> ListQueries.escape_like(needle) <> "%"

    from w in query,
      join: l in Lot,
      on: l.id == w.stock_lot_id,
      join: i in Backend.Items.Item,
      on: i.id == l.item_id,
      where: ilike(i.name, ^like) or ilike(i.external_sku, ^like)
  end

  defp maybe_lot_code_filter(query, nil), do: query

  defp maybe_lot_code_filter(query, needle) when is_binary(needle) do
    like = "%" <> ListQueries.escape_like(needle) <> "%"

    from w in query,
      join: l in Lot,
      on: l.id == w.stock_lot_id,
      where: ilike(l.supplier_batch_no, ^like)
  end

  # -------------------------------------------------------------------
  # Read one
  # -------------------------------------------------------------------

  @doc "Preload spec for a detail-view fetch."
  def detail_preloads do
    [
      :created_by,
      :approved_by,
      :authorised_by,
      :reverted_by,
      :destination_cell,
      :linked_movement,
      :revert_movement,
      stock_lot: [:item, :unit_of_measurement, placements: [:storage_cell]]
    ]
  end

  @doc "Fetch a single write-off for the actor's company, or nil."
  def get(company_id, uuid) when is_integer(company_id) and is_binary(uuid) do
    Repo.one(
      from w in WriteOff,
        where: w.company_id == ^company_id and w.uuid == ^uuid,
        preload: [
          :created_by,
          :approved_by,
          :authorised_by,
          :reverted_by,
          :destination_cell,
          :linked_movement,
          :revert_movement,
          stock_lot: [:item, :unit_of_measurement, placements: [:storage_cell]]
        ]
    )
  end

  # -------------------------------------------------------------------
  # Create draft
  # -------------------------------------------------------------------

  @doc """
  Create a new draft write-off for the given lot. `attrs` needs
  `qty`, `reason_category`, `reason_narrative`, `disposal_method`.
  Optional: `placement_id`, `destination_cell_id`, `currency_snapshot`.

  Snapshots the lot's unit_cost + currency at creation time so a
  retroactive lot re-cost doesn't rewrite history on the write-off
  row's monetary impact.
  """
  def create_draft(%User{} = actor, %Lot{} = lot, attrs) do
    attrs =
      attrs
      |> Map.put("stock_lot_id", lot.id)
      |> Map.put("company_id", lot.company_id)
      |> Map.put("created_by_id", actor.id)
      |> Map.put_new("unit_cost_snapshot", lot.unit_cost)
      |> Map.put_new("currency_snapshot", lot.currency)

    %WriteOff{}
    |> WriteOff.draft_changeset(attrs)
    |> Repo.insert()
    |> tap_audit(actor, "created")
  end

  @doc """
  Edit a `draft` write-off's fields. Locked out on any other status
  — auditors want ``pending_approval`` onwards to be immutable to
  the creator.
  """
  def update_draft(%User{} = actor, %WriteOff{status: "draft"} = wo, attrs) do
    wo
    |> WriteOff.draft_changeset(attrs)
    |> Repo.update()
    |> tap_audit(actor, "updated")
  end

  def update_draft(_actor, %WriteOff{status: status}, _attrs),
    do: {:error, {:invalid_transition, "draft edits blocked in status #{status}"}}

  @doc """
  Delete a `draft` write-off. Only drafts — anything past submit is
  immutable and reverts (not deletes) instead.
  """
  def delete_draft(%User{} = actor, %WriteOff{status: "draft"} = wo) do
    wo
    |> Repo.delete()
    |> tap_audit(actor, "deleted")
  end

  def delete_draft(_actor, %WriteOff{status: status}),
    do: {:error, {:invalid_transition, "cannot delete a #{status} write-off"}}

  # -------------------------------------------------------------------
  # State machine
  # -------------------------------------------------------------------

  @doc """
  Creator submits the draft for review → `pending_approval`.
  No password required (still the same session that wrote it).
  """
  def submit_for_review(%User{} = actor, %WriteOff{status: "draft"} = wo) do
    with :ok <- assert_creator(actor, wo) do
      now = utc_now()

      wo
      |> WriteOff.transition_changeset(%{
        status: "pending_approval",
        submitted_at: now
      })
      |> Repo.update()
      |> tap_audit(actor, "submitted")
    end
  end

  def submit_for_review(_actor, %WriteOff{status: status}),
    do: {:error, {:invalid_transition, "cannot submit from status #{status}"}}

  @doc """
  Approver (≠ creator) signs off with password re-entry + note.
  Advances to `pending_authorisation`. This is where a QC manager
  says "yes I've looked at the evidence, this is legitimate".
  """
  def approve(%User{} = actor, %WriteOff{status: "pending_approval"} = wo, %{
        password: password,
        note: note
      }) do
    with :ok <- verify_password(actor, password),
         :ok <- assert_distinct_actor(actor, wo, [:created_by_id]) do
      now = utc_now()

      wo
      |> WriteOff.transition_changeset(%{
        status: "pending_authorisation",
        approved_by_id: actor.id,
        approved_at: now,
        approved_note: note
      })
      |> Repo.update()
      |> tap_audit(actor, "approved")
    end
  end

  def approve(_actor, %WriteOff{status: status}, _),
    do: {:error, {:invalid_transition, "cannot approve from status #{status}"}}

  @doc """
  Authoriser (≠ creator + ≠ approver) signs off with password +
  note. This is the terminal signature — it fires the actual
  `adjust_down` movement, decrements the placement, and flips the
  status to `active`.
  """
  def authorise(%User{} = actor, %WriteOff{status: "pending_authorisation"} = wo, %{
        password: password,
        note: note
      }) do
    wo = Repo.preload(wo, stock_lot: [placements: [:storage_cell]])

    with :ok <- verify_password(actor, password),
         :ok <-
           assert_distinct_actor(actor, wo, [:created_by_id, :approved_by_id]),
         {:ok, placement} <- resolve_placement(wo) do
      now = utc_now()

      Repo.transaction(fn ->
        with {:ok, updated_placement} <-
               apply_delta(placement, Decimal.negate(wo.qty)),
             {:ok, movement} <- insert_writeoff_movement(actor, wo, placement, now),
             {:ok, activated} <-
               wo
               |> WriteOff.transition_changeset(%{
                 status: "active",
                 authorised_by_id: actor.id,
                 authorised_at: now,
                 authorised_note: note,
                 activated_at: now,
                 linked_movement_id: movement.id
               })
               |> Repo.update() do
          Audit.record_updated(actor, "stock_write_off", activated,
            %{status: "pending_authorisation"},
            %{status: "active", linked_movement_id: movement.id}
          )

          _ = updated_placement
          activated
        else
          {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
    end
  end

  def authorise(_actor, %WriteOff{status: status}, _),
    do: {:error, {:invalid_transition, "cannot authorise from status #{status}"}}

  @doc """
  Reject a pending write-off back to draft with a note. Any of
  approver / authoriser can do this. Note becomes an audit event.
  """
  def reject(%User{} = actor, %WriteOff{status: status} = wo, %{
        password: password,
        note: note
      })
      when status in ["pending_approval", "pending_authorisation"] do
    with :ok <- verify_password(actor, password),
         :ok <- assert_distinct_actor(actor, wo, [:created_by_id]) do
      # Reject clears the approver signature (if any) so the flow
      # restarts cleanly — a new approver can revisit.
      wo
      |> WriteOff.transition_changeset(%{
        status: "draft",
        approved_by_id: nil,
        approved_at: nil,
        approved_note: nil
      })
      |> Repo.update()
      |> tap_audit(actor, "rejected: #{note}")
    end
  end

  def reject(_actor, %WriteOff{status: status}, _),
    do: {:error, {:invalid_transition, "cannot reject from status #{status}"}}

  @doc """
  Revert an active write-off. Writes the inverse `adjust_up`
  movement, restores the placement qty, flips status to `reverted`.
  Row stays for the audit chain.
  """
  def revert(%User{} = actor, %WriteOff{status: "active"} = wo, %{
        password: password,
        reason: reason
      })
      when is_binary(reason) and byte_size(reason) >= 10 do
    wo = Repo.preload(wo, stock_lot: [placements: [:storage_cell]])

    with :ok <- verify_password(actor, password),
         {:ok, placement} <- resolve_placement_for_revert(wo) do
      now = utc_now()

      Repo.transaction(fn ->
        with {:ok, _updated_placement} <- apply_delta(placement, wo.qty),
             {:ok, movement} <-
               insert_writeoff_revert_movement(actor, wo, placement, now, reason),
             {:ok, reverted} <-
               wo
               |> WriteOff.transition_changeset(%{
                 status: "reverted",
                 reverted_by_id: actor.id,
                 reverted_at: now,
                 revert_reason: reason,
                 revert_movement_id: movement.id
               })
               |> Repo.update() do
          Audit.record_updated(actor, "stock_write_off", reverted,
            %{status: "active"},
            %{status: "reverted", revert_movement_id: movement.id}
          )

          reverted
        else
          {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
    end
  end

  def revert(_actor, %WriteOff{status: status}, _),
    do: {:error, {:invalid_transition, "cannot revert from status #{status}"}}

  def revert(_actor, _wo, %{reason: reason}) when byte_size(reason) < 10,
    do: {:error, :revert_reason_too_short}

  # -------------------------------------------------------------------
  # Helpers
  # -------------------------------------------------------------------

  # The Accounts module exposes `valid_password?/2` on User via
  # Bcrypt; verify_password wraps it in an `:ok / {:error, ...}` tuple.
  defp verify_password(%User{} = actor, password)
       when is_binary(password) and password != "" do
    if Backend.Accounts.User.valid_password?(actor, password),
      do: :ok,
      else: {:error, :bad_password}
  end

  defp verify_password(_actor, _password), do: {:error, :bad_password}

  defp assert_creator(%User{id: id}, %WriteOff{created_by_id: id}), do: :ok
  defp assert_creator(_actor, _wo), do: {:error, :not_creator}

  defp assert_distinct_actor(%User{id: id}, %WriteOff{} = wo, forbidden_fields) do
    forbidden_ids =
      forbidden_fields
      |> Enum.map(&Map.get(wo, &1))
      |> Enum.filter(&is_integer/1)

    cond do
      id not in forbidden_ids ->
        :ok

      # Dev bypass — same escape hatch as `Backend.GoodsIn` / MO
      # approval flows use. `config :backend, :enforce_four_eyes,
      # false` in dev.exs lets one seat drive create + approve +
      # authorise. Prod defaults to `true` (BRCGS §5.9 three-eyes on
      # write-offs stays real).
      not Backend.FourEyes.enforce?() ->
        :ok

      true ->
        {:error, :actor_conflict}
    end
  end

  # Placement resolution: if the draft named one, use it. Otherwise
  # a lot with a single non-zero placement can auto-resolve. Split
  # lots without an explicit placement can't advance — the creator
  # has to specify to keep the audit precise.
  defp resolve_placement(%WriteOff{placement_id: id}) when is_integer(id) do
    case Repo.get(Placement, id) do
      nil -> {:error, :placement_not_found}
      %Placement{} = p -> {:ok, p}
    end
  end

  defp resolve_placement(%WriteOff{} = wo) do
    non_zero =
      wo.stock_lot.placements
      |> Enum.filter(fn p -> Decimal.compare(p.qty, Decimal.new("0")) == :gt end)

    case non_zero do
      [single] -> {:ok, single}
      [] -> {:error, :no_stock_left}
      _ -> {:error, :ambiguous_placement}
    end
  end

  # On revert we try to route stock back into the same placement the
  # write-off drew from (via `linked_movement.from_cell_id`). If that
  # placement no longer exists (unlikely, but possible after storage
  # reorganisation), fall through to the lot's first live placement.
  defp resolve_placement_for_revert(%WriteOff{linked_movement_id: mov_id} = wo)
       when is_integer(mov_id) do
    case Repo.get(Movement, mov_id) do
      %Movement{from_cell_id: cell_id} when is_integer(cell_id) ->
        find_or_seed_placement_for_cell(wo, cell_id)

      _ ->
        fallback_placement(wo)
    end
  end

  defp resolve_placement_for_revert(%WriteOff{} = wo), do: fallback_placement(wo)

  defp find_or_seed_placement_for_cell(%WriteOff{stock_lot_id: lot_id}, cell_id) do
    case Repo.get_by(Placement, stock_lot_id: lot_id, storage_cell_id: cell_id) do
      %Placement{} = p ->
        {:ok, p}

      nil ->
        # Placement was zeroed by the writeoff + garbage-collected by
        # ``write_adjusted_placement`` when qty hit 0. Re-create with
        # 0 qty so ``apply_delta`` has a row to land on.
        seed_placement(lot_id, cell_id)
    end
  end

  defp seed_placement(lot_id, cell_id) do
    %Placement{}
    |> Ecto.Changeset.cast(
      %{
        "stock_lot_id" => lot_id,
        "storage_cell_id" => cell_id,
        "qty" => Decimal.new("0")
      },
      [:stock_lot_id, :storage_cell_id, :qty]
    )
    |> Repo.insert()
  end

  defp fallback_placement(%WriteOff{stock_lot: %{placements: [first | _]}}),
    do: {:ok, first}

  defp fallback_placement(_wo), do: {:error, :no_placement}

  # Simple qty mutation — mirrors ``Backend.Stock.write_adjusted_placement``
  # semantics but scoped to write-off use. Rejects a delta that would
  # push the placement below zero.
  defp apply_delta(%Placement{qty: qty} = placement, %Decimal{} = delta) do
    new_qty = Decimal.add(qty, delta)

    if Decimal.compare(new_qty, Decimal.new("0")) == :lt do
      {:error, :insufficient_qty}
    else
      placement
      |> Ecto.Changeset.change(qty: new_qty)
      |> Repo.update()
    end
  end

  defp insert_writeoff_movement(%User{} = actor, %WriteOff{} = wo, %Placement{} = p, now) do
    %Movement{}
    |> Movement.changeset(%{
      "company_id" => wo.company_id,
      "stock_lot_id" => wo.stock_lot_id,
      "from_cell_id" => p.storage_cell_id,
      "to_cell_id" => nil,
      "delta_qty" => Decimal.negate(wo.qty),
      "kind" => "dispose",
      "reason" =>
        "Write-off " <>
          (wo.uuid || "") <>
          " authorised. " <> String.slice(wo.reason_narrative, 0, 500),
      "reason_category" => wo.reason_category,
      "reference_kind" => "adjustment",
      "reference_ref" => wo.uuid,
      "actor_id" => actor.id,
      "occurred_at" => now
    })
    |> Repo.insert()
  end

  defp insert_writeoff_revert_movement(%User{} = actor, %WriteOff{} = wo, %Placement{} = p, now, reason) do
    %Movement{}
    |> Movement.changeset(%{
      "company_id" => wo.company_id,
      "stock_lot_id" => wo.stock_lot_id,
      "from_cell_id" => nil,
      "to_cell_id" => p.storage_cell_id,
      "delta_qty" => wo.qty,
      "kind" => "adjust_up",
      "reason" =>
        "Reverted write-off " <>
          (wo.uuid || "") <>
          ". Reason: " <> String.slice(reason, 0, 400),
      "reason_category" => "admin_correction",
      "reference_kind" => "adjustment",
      "reference_ref" => wo.uuid,
      "actor_id" => actor.id,
      "occurred_at" => now
    })
    |> Repo.insert()
  end

  defp utc_now, do: DateTime.utc_now() |> DateTime.truncate(:second)

  defp tap_audit({:ok, wo} = res, actor, action) do
    Audit.record_updated(
      actor,
      "stock_write_off",
      wo,
      %{},
      %{
        status: wo.status,
        action: action,
        reason_category: wo.reason_category
      }
    )

    res
  end

  defp tap_audit(other, _actor, _action), do: other
end
