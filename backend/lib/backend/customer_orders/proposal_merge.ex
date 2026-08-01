defmodule Backend.CustomerOrders.ProposalMerge do
  @moduledoc """
  Consolidate N R&D draft CustomerOrders into ONE when a proposal is
  drafted on NPD.

  Trigger: NPD's ``create_proposal`` / ``create_proposal_bundle`` fires
  a merge sync (``POST /api/integration/customer-orders/from-proposal``)
  carrying the proposal identity + the list of formulation UUIDs the
  proposal spans. This module resolves those N COs on PSP, picks the
  first as *primary*, absorbs everything else into it, and marks the
  N-1 secondary rows as ``merged_into_id: primary.id`` for audit.

  What "absorb" means concretely:

    * **Comments** — the polymorphic ``comments`` table has one row per
      author-timestamped message on ``(entity_type: "customer_order",
      entity_id: co.id)``. We reassign every secondary CO's comments
      to the primary CO so the merged conversation preserves the full
      R&D chat history in one place. Author + inserted_at preserved.

    * **Lines** — the source R&D drafts don't have order lines (they're
      idea projects, not orders). But we *do* create one CO line per
      ProposalLine from NPD, so the primary CO becomes a real order
      shape: ``{item: formulation.psp_finished_product_uuid, qty, unit_price}``.

    * **Metadata** — proposal identity (uuid / code / url / status)
      planted on the primary so the wizard advances from
      ``:awaiting_proposal`` through ``:awaiting_proposal_approval``
      → ``:proposal_ready_to_send`` → ``:awaiting_customer_signature``
      as the NPD-side status transitions.

  Idempotent by ``npd_proposal_uuid``: a re-fire from NPD (proposal
  regenerated, or a retry after a network error) finds the existing
  primary and re-syncs the lines rather than merging again.
  """

  import Ecto.Query

  alias Backend.CustomerOrders.CustomerOrder
  alias Backend.CustomerOrders.CustomerOrderLine
  alias Backend.Comments.Comment
  alias Backend.Items.Item
  alias Backend.Repo

  @doc """
  Merge N R&D COs into one primary + attach the proposal identity.

  Payload shape (from NPD):

      %{
        "npd_proposal_uuid"    => "…uuid…",
        "npd_proposal_code"    => "PROP-0421",
        "npd_proposal_url"     => "https://npd.example.com/proposals/…",
        "customer_uuid"        => "…uuid…" | nil,
        "customer_display_name"=> "Cherya Beauty" | nil,
        "lines" => [
          %{
            "npd_formulation_uuid" => "…uuid…",
            "psp_finished_product_uuid" => "…uuid…" | nil,
            "quantity" => 1,
            "unit_price" => "12.34",
            "line_subtotal" => "12.34"
          },
          …
        ]
      }

  The FIRST line's ``npd_formulation_uuid`` picks the primary CO;
  every other formulation UUID gets absorbed.
  """
  def merge_from_proposal(company_id, params) when is_integer(company_id) do
    with {:ok, proposal_uuid} <- extract_proposal_uuid(params),
         {:ok, line_specs} <- extract_lines(params) do
      Repo.transaction(fn ->
        do_merge(company_id, proposal_uuid, line_specs, params)
      end)
      |> case do
        {:ok, {:ok, co}} -> {:ok, co}
        {:ok, {:error, reason}} -> {:error, reason}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  @doc """
  Reverse the merge — split the primary back into N R&D drafts.

  Called when NPD deletes the underlying Proposal. Restores the
  world to what it was before the merge:

    * Every secondary CO's ``merged_into_id`` is cleared, so it
      reappears in the wizard as its own R&D draft.
    * Every comment that was fanned onto the primary during the
      merge (identified by ``pre_merge_entity_id``) flies back to
      its original CO. The primary keeps only the comments that
      were natively its own before the merge.
    * The primary's proposal identity — uuid / code / url / status
      / transition timestamps / timeline — is wiped, so the wizard
      snaps the primary back to ``:r_and_d``.
    * The primary's proposal-derived order lines are deleted; R&D
      drafts don't carry order lines.

  Idempotent — a re-fire with an already-unmerged proposal_uuid
  returns ``{:ok, :no_op}`` rather than raising.
  """
  def unmerge_from_proposal(company_id, proposal_uuid)
      when is_integer(company_id) and is_binary(proposal_uuid) do
    with {:ok, uuid} <- cast_proposal_uuid(proposal_uuid) do
      Repo.transaction(fn -> do_unmerge(company_id, uuid) end)
      |> case do
        {:ok, {:ok, result}} -> {:ok, result}
        {:ok, {:error, reason}} -> {:error, reason}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp cast_proposal_uuid(raw) do
    case Ecto.UUID.cast(raw) do
      {:ok, uuid} -> {:ok, uuid}
      _ -> {:error, :bad_proposal_uuid}
    end
  end

  defp do_unmerge(company_id, proposal_uuid) do
    case Repo.get_by(CustomerOrder,
           company_id: company_id,
           npd_proposal_uuid: proposal_uuid
         ) do
      nil ->
        {:ok, :no_op}

      %CustomerOrder{} = primary ->
        secondaries =
          Repo.all(
            from co in CustomerOrder,
              where: co.company_id == ^company_id,
              where: co.merged_into_id == ^primary.id
          )

        # Snapshot the primary's timeline BEFORE any mutation and
        # build the unmerge event once. Both the primary (which
        # keeps its own history + the new event) and every secondary
        # (which inherits the whole primary timeline so each split-
        # back project shows the full lifecycle: formulation drafted
        # → spec approved → merged → proposal transitions → rejected
        # → unmerged) get the same audit anchor. Without this, an
        # audit reader looking at a split-back R&D project would see
        # an empty timeline and no evidence that the project ever
        # rode a proposal, which is exactly the trail
        # BRCGS/ISO auditors look for.
        pre_unmerge_timeline = primary.npd_timeline || []
        unmerge_event = build_unmerge_event(primary)
        inherited_timeline = pre_unmerge_timeline ++ [unmerge_event]

        Enum.each(secondaries, fn co ->
          restore_comments_to!(co.id)
          clear_merged_into!(co)
          write_timeline!(co, inherited_timeline)
        end)

        wipe_proposal_identity!(primary, unmerge_event)
        delete_primary_lines!(primary.id)

        # Refresh so the notify carries clean fields; the wizard
        # projection reads from these to snap the primary back to
        # ``:r_and_d``.
        primary = Repo.get!(CustomerOrder, primary.id)
        Backend.OrderWizard.notify_co_changed(primary)

        Enum.each(secondaries, fn co ->
          Backend.OrderWizard.notify_co_changed(Repo.get!(CustomerOrder, co.id))
        end)

        {:ok,
         %{
           primary_uuid: primary.uuid,
           unmerged_secondaries: Enum.map(secondaries, & &1.uuid)
         }}
    end
  end

  # Build the timeline entry that records the unmerge itself.
  # Placed at the end of the inherited timeline so readers see it
  # after every prior lifecycle event (including any "Proposal
  # moved from Sent to Rejected — Reason: …" entries that NPD
  # sends). Rejection context lives in those earlier entries,
  # not here — this event is just the "curtain call" marker.
  defp build_unmerge_event(%CustomerOrder{} = primary) do
    code = primary.npd_proposal_code || "proposal"

    %{
      "at" => DateTime.utc_now() |> DateTime.to_iso8601(),
      "label" =>
        "Unmerged from #{code} — split back into individual R&D project.",
      "actor" => "",
      "href" => primary.npd_proposal_url || "",
      "kind" => "proposal_unmerged"
    }
  end

  defp write_timeline!(%CustomerOrder{} = co, timeline) when is_list(timeline) do
    co
    |> Ecto.Changeset.change(%{npd_timeline: timeline})
    |> Repo.update!()

    :ok
  end

  # Fan every comment tagged with ``pre_merge_entity_id = source_co_id``
  # back to that source, clearing the breadcrumb as we go so a future
  # re-merge starts from a clean slate.
  defp restore_comments_to!(source_co_id) do
    from(c in Comment,
      where: c.entity_type == "customer_order",
      where: c.pre_merge_entity_id == ^source_co_id
    )
    |> Repo.update_all(set: [entity_id: source_co_id, pre_merge_entity_id: nil])

    :ok
  end

  defp clear_merged_into!(%CustomerOrder{} = co) do
    co
    |> Ecto.Changeset.change(%{merged_into_id: nil})
    |> Repo.update!()

    :ok
  end

  defp wipe_proposal_identity!(%CustomerOrder{} = primary, unmerge_event) do
    # Clear the *identity* fields so the wizard bounces back to
    # ``:r_and_d`` — but PRESERVE the timeline and append the unmerge
    # event. The proposal is dead; the story of what happened is not.
    # Auditors need to be able to reconstruct that this CO was once
    # part of a proposal, that proposal was rejected/deleted (with
    # reason, if provided), and it was split back out on this date.
    new_timeline = (primary.npd_timeline || []) ++ [unmerge_event]

    primary
    |> Ecto.Changeset.change(%{
      npd_proposal_uuid: nil,
      npd_proposal_code: nil,
      npd_proposal_url: nil,
      npd_proposal_status: nil,
      npd_proposal_created_at: nil,
      npd_proposal_created_by_name: nil,
      npd_proposal_director_approved_at: nil,
      npd_proposal_director_name: nil,
      npd_proposal_sent_at: nil,
      npd_proposal_sent_by_name: nil,
      npd_proposal_accepted_at: nil,
      npd_proposal_accepted_by_name: nil,
      npd_timeline: new_timeline
    })
    |> Repo.update!()

    :ok
  end

  defp delete_primary_lines!(primary_id) do
    from(l in CustomerOrderLine, where: l.customer_order_id == ^primary_id)
    |> Repo.delete_all()

    :ok
  end

  # ---- transactional body ----------------------------------------

  defp do_merge(company_id, proposal_uuid, line_specs, params) do
    # Re-fire idempotency: if a row already claims this proposal UUID,
    # it's the primary from a previous merge. Refresh the lines to
    # cover the "proposal was regenerated" path and return.
    case Repo.get_by(CustomerOrder,
           company_id: company_id,
           npd_proposal_uuid: proposal_uuid
         ) do
      nil ->
        fresh_merge(company_id, proposal_uuid, line_specs, params)

      %CustomerOrder{} = primary ->
        refresh_existing(primary, line_specs, params)
    end
  end

  defp fresh_merge(company_id, proposal_uuid, line_specs, params) do
    formulation_uuids =
      line_specs
      |> Enum.map(& &1.npd_formulation_uuid)
      |> Enum.uniq()

    # Resolve every CO by npd_formulation_uuid. Order in ``line_specs``
    # is authoritative: the first one wins as primary. A missing CO
    # means NPD never synced the formulation yet — surface as an
    # error so the caller can retry rather than silently dropping the
    # row.
    cos =
      from(co in CustomerOrder,
        where: co.company_id == ^company_id,
        where: co.npd_formulation_uuid in ^formulation_uuids
      )
      |> Repo.all()
      |> Map.new(&{&1.npd_formulation_uuid, &1})

    primary_uuid = hd(line_specs).npd_formulation_uuid
    primary = Map.get(cos, primary_uuid)

    if is_nil(primary) do
      Repo.rollback({:missing_formulation, primary_uuid})
    end

    # Everyone else — reassign their comments to the primary, mark
    # merged_into, and (defensively) reassign any stray lines. A
    # secondary CO with lines shouldn't exist in R&D flow, but if a
    # scientist did anything unusual the safest move is to keep the
    # data reachable.
    secondaries =
      cos
      |> Map.values()
      |> Enum.reject(&(&1.id == primary.id))

    Enum.each(secondaries, fn co ->
      reassign_comments!(co.id, primary.id)
      reassign_lines!(co.id, primary.id)
      mark_merged!(co, primary.id)
    end)

    primary
    |> apply_proposal_identity(proposal_uuid, params)
    |> replace_lines_from_specs(line_specs)
    |> case do
      {:ok, updated} ->
        Backend.OrderWizard.notify_co_changed(updated)
        {:ok, updated}

      {:error, reason} ->
        Repo.rollback(reason)
    end
  end

  defp refresh_existing(%CustomerOrder{} = primary, line_specs, params) do
    primary
    |> apply_proposal_identity(primary.npd_proposal_uuid, params)
    |> replace_lines_from_specs(line_specs)
    |> case do
      {:ok, updated} ->
        Backend.OrderWizard.notify_co_changed(updated)
        {:ok, updated}

      {:error, reason} ->
        Repo.rollback(reason)
    end
  end

  # ---- absorb steps ----------------------------------------------

  defp reassign_comments!(source_co_id, target_co_id) do
    # ``pre_merge_entity_id`` captures the row's home CO at merge
    # time so ``unmerge_from_proposal/2`` can fan comments back later.
    # We only stamp it on rows that don't already have one — a re-fire
    # would otherwise overwrite the true origin with the primary's id.
    from(c in Comment,
      where: c.entity_type == "customer_order",
      where: c.entity_id == ^source_co_id,
      where: is_nil(c.pre_merge_entity_id)
    )
    |> Repo.update_all(set: [pre_merge_entity_id: source_co_id])

    from(c in Comment,
      where: c.entity_type == "customer_order",
      where: c.entity_id == ^source_co_id
    )
    |> Repo.update_all(set: [entity_id: target_co_id])

    :ok
  end

  defp reassign_lines!(source_co_id, target_co_id) do
    from(l in CustomerOrderLine, where: l.customer_order_id == ^source_co_id)
    |> Repo.update_all(set: [customer_order_id: target_co_id])

    :ok
  end

  defp mark_merged!(%CustomerOrder{} = co, primary_id) do
    co
    |> Ecto.Changeset.change(%{merged_into_id: primary_id})
    |> Repo.update!()

    :ok
  end

  # ---- primary CO updates ----------------------------------------

  defp apply_proposal_identity(%CustomerOrder{} = primary, proposal_uuid, params) do
    # NPD authoritative for the proposal's own status; PSP just
    # mirrors. Empty string on the wire is treated as "clear it" so
    # a proposal reverted to draft on NPD can flip the wizard back
    # to Awaiting approval.
    status_raw =
      params["npd_proposal_status"] || params[:npd_proposal_status]

    status_attr =
      case status_raw do
        nil -> %{}
        "" -> %{npd_proposal_status: nil}
        s when is_binary(s) -> %{npd_proposal_status: String.trim(s)}
        _ -> %{}
      end

    # Transition timestamps + actor names. NPD is authoritative and
    # sends nils for transitions that haven't happened; we overwrite
    # unconditionally so a "revert to draft" flow can wipe a stale
    # ``director_approved_at`` back to nil.
    transition_attrs = %{
      npd_proposal_created_at: parse_datetime(params["npd_proposal_created_at"]),
      npd_proposal_created_by_name:
        sanitize(params["npd_proposal_created_by_name"]),
      npd_proposal_director_approved_at:
        parse_datetime(params["npd_proposal_director_approved_at"]),
      npd_proposal_director_name:
        sanitize(params["npd_proposal_director_name"]),
      npd_proposal_sent_at: parse_datetime(params["npd_proposal_sent_at"]),
      npd_proposal_sent_by_name:
        sanitize(params["npd_proposal_sent_by_name"]),
      npd_proposal_accepted_at:
        parse_datetime(params["npd_proposal_accepted_at"]),
      npd_proposal_accepted_by_name:
        sanitize(params["npd_proposal_accepted_by_name"])
    }

    # Full audit event log — NPD is authoritative and replaces the
    # array in full every sync. Nil / non-list payloads skip the
    # write so a malformed request can't wipe history.
    timeline_attr =
      case normalise_timeline(params["timeline"] || params[:timeline]) do
        nil -> %{}
        list -> %{npd_timeline: list}
      end

    attrs =
      %{
        npd_proposal_uuid: proposal_uuid,
        npd_proposal_code: sanitize(params["npd_proposal_code"]),
        npd_proposal_url: sanitize(params["npd_proposal_url"])
      }
      |> Enum.reject(fn {_k, v} -> is_nil(v) end)
      |> Map.new()
      |> Map.merge(status_attr)
      |> Map.merge(transition_attrs)
      |> Map.merge(timeline_attr)

    Ecto.Changeset.change(primary, attrs)
  end

  # Preserve NPD's ordering (already sorted ascending by ``at``) —
  # we only strip entries that don't have a timestamp AND a label,
  # anything else stays intact. Non-list payloads produce nil so the
  # existing column value survives.
  defp normalise_timeline(nil), do: nil

  defp normalise_timeline(list) when is_list(list) do
    list
    |> Enum.map(&normalise_timeline_entry/1)
    |> Enum.reject(&is_nil/1)
  end

  defp normalise_timeline(_), do: nil

  defp normalise_timeline_entry(%{} = raw) do
    at = raw["at"] || raw[:at]
    label = raw["label"] || raw[:label]

    if is_binary(at) and is_binary(label) and label != "" do
      %{
        "at" => at,
        "label" => label,
        "actor" => sanitize_or_empty(raw["actor"] || raw[:actor]),
        "href" => sanitize_or_empty(raw["href"] || raw[:href]),
        "kind" => sanitize_or_empty(raw["kind"] || raw[:kind])
      }
    end
  end

  defp normalise_timeline_entry(_), do: nil

  defp sanitize_or_empty(nil), do: nil
  defp sanitize_or_empty(""), do: nil
  defp sanitize_or_empty(v) when is_binary(v), do: v
  defp sanitize_or_empty(_), do: nil

  defp parse_datetime(nil), do: nil
  defp parse_datetime(""), do: nil

  defp parse_datetime(raw) when is_binary(raw) do
    case DateTime.from_iso8601(raw) do
      {:ok, dt, _offset} -> DateTime.truncate(dt, :second)
      _ -> nil
    end
  end

  defp parse_datetime(%DateTime{} = dt), do: DateTime.truncate(dt, :second)
  defp parse_datetime(_), do: nil

  # Wipe existing lines on the primary and insert fresh ones from the
  # proposal spec. Cleaner than diffing — proposals aren't edited in
  # place today, they get regenerated end-to-end.
  defp replace_lines_from_specs(changeset, line_specs) do
    case Repo.update(changeset) do
      {:ok, %CustomerOrder{} = primary} ->
        from(l in CustomerOrderLine,
          where: l.customer_order_id == ^primary.id
        )
        |> Repo.delete_all()

        Enum.each(line_specs, &insert_line_for!(primary, &1))
        {:ok, Repo.preload(primary, :lines, force: true)}

      {:error, cs} ->
        {:error, cs}
    end
  end

  defp insert_line_for!(%CustomerOrder{} = primary, spec) do
    item_id = resolve_item_id(primary.company_id, spec.psp_finished_product_uuid)

    # A proposal line without a resolvable finished-product item can
    # still land — it's a lead-with-price row that the operator will
    # bind to an item later on PSP. We keep the qty + unit_price so
    # the operator doesn't lose the number.
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    line_attrs = %{
      customer_order_id: primary.id,
      company_id: primary.company_id,
      item_id: item_id,
      qty_ordered: to_decimal(spec.quantity, Decimal.new(1)),
      unit_price: to_decimal(spec.unit_price, Decimal.new(0)),
      line_subtotal: to_decimal(spec.line_subtotal, Decimal.new(0)),
      inserted_at: now,
      updated_at: now
    }

    %CustomerOrderLine{}
    |> CustomerOrderLine.changeset(line_attrs)
    |> Repo.insert!()
  end

  defp resolve_item_id(_company_id, nil), do: nil

  defp resolve_item_id(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast_uuid} ->
        Repo.one(
          from(i in Item,
            where: i.company_id == ^company_id,
            where: i.uuid == ^cast_uuid,
            select: i.id
          )
        )

      :error ->
        nil
    end
  end

  defp resolve_item_id(_company_id, _), do: nil

  # ---- payload extraction ----------------------------------------

  defp extract_proposal_uuid(params) do
    raw = params["npd_proposal_uuid"] || params[:npd_proposal_uuid]

    case raw && Ecto.UUID.cast(raw) do
      {:ok, uuid} -> {:ok, uuid}
      _ -> {:error, :bad_proposal_uuid}
    end
  end

  defp extract_lines(params) do
    raw = params["lines"] || params[:lines] || []

    case raw do
      [] ->
        {:error, :no_lines}

      list when is_list(list) ->
        specs =
          Enum.map(list, fn row ->
            %{
              npd_formulation_uuid:
                cast_uuid!(row["npd_formulation_uuid"] || row[:npd_formulation_uuid]),
              psp_finished_product_uuid:
                maybe_cast_uuid(
                  row["psp_finished_product_uuid"] ||
                    row[:psp_finished_product_uuid]
                ),
              quantity: row["quantity"] || row[:quantity] || 1,
              unit_price: row["unit_price"] || row[:unit_price],
              line_subtotal: row["line_subtotal"] || row[:line_subtotal]
            }
          end)

        if Enum.any?(specs, &is_nil(&1.npd_formulation_uuid)) do
          {:error, :bad_formulation_uuid}
        else
          {:ok, specs}
        end
    end
  end

  defp cast_uuid!(nil), do: nil

  defp cast_uuid!(raw) when is_binary(raw) do
    case Ecto.UUID.cast(raw) do
      {:ok, uuid} -> uuid
      :error -> nil
    end
  end

  defp cast_uuid!(_), do: nil

  defp maybe_cast_uuid(nil), do: nil
  defp maybe_cast_uuid(""), do: nil
  defp maybe_cast_uuid(raw), do: cast_uuid!(raw)

  defp sanitize(nil), do: nil
  defp sanitize(""), do: nil
  defp sanitize(v) when is_binary(v), do: String.trim(v)
  defp sanitize(_), do: nil

  defp to_decimal(nil, default), do: default

  defp to_decimal(v, _default) when is_binary(v) do
    case Decimal.parse(v) do
      {d, _} -> d
      :error -> Decimal.new(0)
    end
  end

  defp to_decimal(v, _default) when is_integer(v), do: Decimal.new(v)
  defp to_decimal(v, _default) when is_float(v), do: Decimal.from_float(v)
  defp to_decimal(%Decimal{} = v, _default), do: v
  defp to_decimal(_, default), do: default
end
