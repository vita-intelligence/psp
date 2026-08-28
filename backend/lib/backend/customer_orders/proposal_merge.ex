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
    project_type = sanitize(params["npd_project_type"]) || ""

    if project_type == "ready_to_go" do
      rtg_fresh_merge(company_id, proposal_uuid, line_specs, params)
    else
      custom_fresh_merge(company_id, proposal_uuid, line_specs, params)
    end
  end

  # Custom formulations are 1:1 with a project on PSP. A new proposal
  # for the same formulation (redraft after reject, next revision, …)
  # updates the existing CO's identity and refreshes its lines — the
  # MO chain, comment thread, and audit history all belong to "this
  # project" and must survive proposal churn. Same behaviour as
  # before RTG landed; kept intact.
  defp custom_fresh_merge(company_id, proposal_uuid, line_specs, params) do
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
        where: co.npd_formulation_uuid in ^formulation_uuids,
        # Never adopt an RTG CO for a Custom merge — RTG rows can
        # legitimately share a formulation_uuid with other orders and
        # must not be captured by a stray Custom sync. Belt-and-
        # braces: today the partial unique index also excludes
        # RTG rows from the formulation-uuid uniqueness invariant.
        where:
          is_nil(co.npd_project_type) or
            co.npd_project_type != "ready_to_go"
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

  # RTG catalog products get ordered N times. Every proposal from the
  # storefront is an independent business object — its own CO, its
  # own lines, its own MOs. We must NOT reuse an existing CO by
  # ``npd_formulation_uuid`` (that would silently overwrite a prior
  # order's proposal identity and wipe its lines, orphaning any MOs
  # the operator had already created against them).
  #
  # This path insert-only for a fresh proposal. Idempotency for a
  # re-fired push is handled upstream in ``do_merge/4`` which looks
  # up by ``npd_proposal_uuid`` first — if the row already exists,
  # ``refresh_existing`` runs instead of ``fresh_merge``.
  defp rtg_fresh_merge(company_id, proposal_uuid, line_specs, params) do
    primary_uuid = hd(line_specs).npd_formulation_uuid

    # Sanity: the formulation must have been synced from NPD at least
    # once so we know the finished-product item + display fields.
    # A missing formulation means the storefront tried to check out
    # before ``sync_customer_order_to_psp`` reached us for this SKU;
    # surface the error rather than birthing a phantom CO whose
    # identity fields would all be nil.
    template =
      from(co in CustomerOrder,
        where: co.company_id == ^company_id,
        where: co.npd_formulation_uuid == ^primary_uuid,
        order_by: [asc: co.inserted_at],
        limit: 1
      )
      |> Repo.one()

    if is_nil(template) do
      Repo.rollback({:missing_formulation, primary_uuid})
    end

    now = DateTime.utc_now() |> DateTime.truncate(:second)

    # Seed a fresh CO with the identity fields the formulation-sync
    # already established (company, customer, currency, warehouse,
    # tax rate, R&D team names, app_url). The proposal-identity
    # attrs land in the same changeset via ``apply_proposal_identity``.
    fresh_attrs = %{
      company_id: template.company_id,
      customer_id: template.customer_id,
      currency_code: template.currency_code,
      tax_rate: template.tax_rate,
      discount_pct: template.discount_pct || Decimal.new(0),
      shipping_fees: template.shipping_fees || Decimal.new(0),
      additional_fees: template.additional_fees || Decimal.new(0),
      default_warehouse_id: template.default_warehouse_id,
      npd_formulation_uuid: template.npd_formulation_uuid,
      npd_lead_scientist_name: template.npd_lead_scientist_name,
      npd_sales_person_name: template.npd_sales_person_name,
      npd_app_url: template.npd_app_url,
      status: "draft",
      sample_kind: false,
      subtotal: Decimal.new(0),
      discount_amount: Decimal.new(0),
      tax_amount: Decimal.new(0),
      grand_total: Decimal.new(0),
      inserted_at: now,
      updated_at: now
    }

    primary =
      %CustomerOrder{}
      |> Ecto.Changeset.change(fresh_attrs)
      |> Repo.insert!()

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
        sanitize(params["npd_proposal_accepted_by_name"]),
      # Customer-side sign timestamp. Distinct from
      # ``npd_proposal_accepted_at`` — the FSM keeps status at
      # ``sent`` after the customer signs; finance runs a
      # separate finalize step. Presence + ``npd_proposal_status
      # = sent`` is the phase-gate signal for the new
      # ``:awaiting_sample_selection`` kanban column.
      npd_customer_signed_at:
        parse_datetime(params["npd_customer_signed_at"]),
      # Bundled deposit+samples Payment approval timestamp. Presence
      # flips the wizard phase from ``:proposal_accepted`` to
      # ``:trial_batches_in_flight`` so the /projects kanban shows
      # the cycle is running (vs. still waiting on the customer to
      # pay). Nil clears the mirror if a payment is voided upstream.
      npd_deposit_paid_at:
        parse_datetime(params["npd_deposit_paid_at"]),
      # FINAL-spec + FINAL-payment lifecycle mirror. NPD is
      # authoritative and re-sends each field on every relevant
      # transition (customer confirmed done, FINAL sent/signed/
      # rejected, FINAL payment approved). Nil overwrites so the
      # reject-and-restart flow — which clears
      # `customer_confirmed_done_at` and re-fires the sync — resets
      # the kanban back to ``:trial_batches_in_flight`` automatically.
      npd_customer_confirmed_done_at:
        parse_datetime(params["npd_customer_confirmed_done_at"]),
      npd_final_spec_uuid:
        sanitize(params["npd_final_spec_uuid"]),
      npd_final_spec_status:
        sanitize(params["npd_final_spec_status"]),
      npd_final_spec_signed_at:
        parse_datetime(params["npd_final_spec_signed_at"]),
      npd_final_spec_rejected_at:
        parse_datetime(params["npd_final_spec_rejected_at"]),
      npd_final_payment_approved_at:
        parse_datetime(params["npd_final_payment_approved_at"]),
      # Label-design workflow mirror. NPD is authoritative and
      # re-sends every field on every LabelDesign mutation (path
      # chosen, artwork uploaded, reviewer verdict, customer
      # approval). Nil overwrites so a customer / staff rollback
      # clears the mirror cleanly.
      npd_label_design_uuid:
        sanitize(params["npd_label_design_uuid"]),
      npd_label_status:
        sanitize(params["npd_label_status"]),
      npd_label_design_path:
        sanitize(params["npd_label_design_path"]),
      npd_label_approved_at:
        parse_datetime(params["npd_label_approved_at"]),
      npd_label_rejection_count:
        parse_integer(params["npd_label_rejection_count"]),
      npd_label_updated_at:
        parse_datetime(params["npd_label_updated_at"]),
      npd_label_preview_png_url:
        sanitize(params["npd_label_preview_png_url"]),
      npd_label_pdf_url:
        sanitize(params["npd_label_pdf_url"]),
      npd_label_url:
        sanitize(params["npd_label_url"])
    }

    # Full audit event log — NPD is authoritative and replaces the
    # array in full every sync. Nil / non-list payloads skip the
    # write so a malformed request can't wipe history.
    timeline_attr =
      case normalise_timeline(params["timeline"] || params[:timeline]) do
        nil -> %{}
        list -> %{npd_timeline: list}
      end

    # Sample-allocation status is a per-line field on the vita-cff
    # payload (each line = one formulation = one allocation). The
    # primary CO corresponds to the first line, so we take THAT
    # line's status. Nil / empty string clears the mirror so a
    # customer who somehow reset their allocation upstream doesn't
    # leave the kanban stuck on ``:awaiting_sample_selection`` /
    # ``:proposal_accepted``.
    first_line =
      case params["lines"] || params[:lines] do
        [head | _] when is_map(head) -> head
        _ -> %{}
      end

    allocation_status_raw =
      first_line["npd_sample_allocation_status"] ||
        first_line[:npd_sample_allocation_status]

    allocation_attr =
      case allocation_status_raw do
        nil -> %{npd_sample_allocation_status: nil}
        "" -> %{npd_sample_allocation_status: nil}
        s when is_binary(s) ->
          %{npd_sample_allocation_status: String.trim(s)}
        _ -> %{}
      end

    # FINAL payment approved on NPD ⇒ the customer has paid the balance
    # and production is authorised. The CO here was born inside the NPD
    # integration (no operator ran the PSP submit / approver-sign /
    # director-sign / mark-confirmed wizard) so gating MO creation on
    # PSP-side manual confirmation would strand the flow. Auto-confirm
    # matches the sample-CO path in ``npd_sync.ex`` — same rationale.
    #
    # Only fire when the CO isn't already in a terminal state — a manually
    # cancelled row shouldn't get resurrected by a downstream sync, and a
    # CO already at ``confirmed`` doesn't need the fields overwritten.
    auto_confirm_attrs =
      case transition_attrs.npd_final_payment_approved_at do
        %DateTime{} when primary.status not in ~w(confirmed cancelled) ->
          now = DateTime.utc_now() |> DateTime.truncate(:second)

          %{
            status: "confirmed",
            submitted_at: primary.submitted_at || now,
            confirmed_at: primary.confirmed_at || now
          }

        _ ->
          %{}
      end

    # Primary-formulation display fields — NPD sends these so PSP
    # can render the /projects card with the customer-facing product
    # name ("Ultimate Fat Burner Drink") instead of whatever
    # ``customer_reference`` was set to before the merge. On RTG the
    # pre-merge value is "Ultimate Fat Burner Drink · Sample #3"
    # (leftover from ``insert_sample_new`` in npd_sync.ex), which is
    # what would keep showing on the operator's kanban if we didn't
    # overwrite it. When NPD doesn't send them (legacy Custom syncs
    # that predate this field), fall back to the existing value —
    # never wipe a valid label with a nil.
    display_name = sanitize(params["primary_formulation_display_name"])
    code = sanitize(params["primary_formulation_code"])

    reference =
      cond do
        display_name && code -> "#{display_name} (#{code})"
        display_name -> display_name
        code -> code
        true -> nil
      end

    reference_attr =
      if reference do
        %{customer_reference: reference}
      else
        %{}
      end

    attrs =
      %{
        npd_proposal_uuid: proposal_uuid,
        npd_proposal_code: sanitize(params["npd_proposal_code"]),
        npd_proposal_url: sanitize(params["npd_proposal_url"]),
        # Project flavour from NPD. Empty string → leave as-is (the
        # ``Enum.reject(is_nil)`` below strips nils, so this keeps
        # legacy Custom-only rows valid before NPD started sending
        # the field).
        npd_project_type: sanitize(params["npd_project_type"]),
        # A merge_from_proposal claims the CO as a REAL commercial
        # order — flip ``sample_kind`` off. Without this a CO that
        # happened to exist as a sample-kit shell (created by an
        # earlier ``sync_customer_order_to_psp`` on the same
        # formulation) stays tagged as a sample, hiding the RTG /
        # Custom product order from the /projects kanban and pinning
        # it under the Samples surface. Merging a proposal onto a
        # sample row promotes it — an audit reader can still see the
        # sample origin via the timeline (which is preserved verbatim
        # by ``timeline_attr``).
        sample_kind: false
      }
      |> Map.merge(reference_attr)
      |> Enum.reject(fn {_k, v} -> is_nil(v) end)
      |> Map.new()
      |> Map.merge(status_attr)
      |> Map.merge(transition_attrs)
      |> Map.merge(timeline_attr)
      |> Map.merge(allocation_attr)
      |> Map.merge(auto_confirm_attrs)

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

  defp parse_integer(nil), do: nil
  defp parse_integer(""), do: nil
  defp parse_integer(v) when is_integer(v), do: v

  defp parse_integer(v) when is_binary(v) do
    case Integer.parse(v) do
      {n, ""} -> n
      _ -> nil
    end
  end

  defp parse_integer(_), do: nil

  # Refresh the primary's lines from the proposal spec.
  #
  # Idempotent: if the existing lines match the incoming spec exactly
  # (same item + qty + unit_price + packaging combo), it's a no-op.
  # A raw wipe-and-reinsert was correct semantically but destructive
  # in practice: every re-sync (label save, proposal re-broadcast,
  # RTG order landing on the same formulation before the RTG fix)
  # DELETEd every CO line, orphaning any MOs the operator had already
  # created against them (FK stays as a dangling integer since the
  # column isn't ON DELETE CASCADE — the MO survives but the ``lines``
  # join returns empty and the FE reads "no MO yet").
  #
  # When the spec HAS changed (customer amended qty, picked a
  # different combo, etc.) we still wipe and reinsert — that's a
  # genuine spec change, not a phantom re-sync, and the operator
  # needs the fresh line data. In that case MOs on the old lines
  # will get orphaned as before; the amendment flow is the right
  # place to handle that migration.
  defp replace_lines_from_specs(changeset, line_specs) do
    case Repo.update(changeset) do
      {:ok, %CustomerOrder{} = primary} ->
        existing =
          from(l in CustomerOrderLine,
            where: l.customer_order_id == ^primary.id,
            order_by: [asc: l.id]
          )
          |> Repo.all()

        if lines_match_specs?(existing, line_specs, primary) do
          {:ok, Repo.preload(primary, :lines, force: true)}
        else
          from(l in CustomerOrderLine,
            where: l.customer_order_id == ^primary.id
          )
          |> Repo.delete_all()

          Enum.each(line_specs, &insert_line_for!(primary, &1))
          {:ok, Repo.preload(primary, :lines, force: true)}
        end

      {:error, cs} ->
        {:error, cs}
    end
  end

  # Are the existing CO lines already in sync with the incoming
  # ``line_specs``? Compares by (item_id, qty, unit_price,
  # packaging_combo_uuid) in positional order — same shape the
  # merge would produce fresh. Any mismatch → not idempotent, caller
  # falls back to wipe-and-reinsert.
  defp lines_match_specs?(existing, specs, %CustomerOrder{} = primary) do
    length(existing) == length(specs) and
      Enum.zip(existing, specs)
      |> Enum.all?(fn {line, spec} -> line_matches_spec?(line, spec, primary) end)
  end

  defp line_matches_spec?(%CustomerOrderLine{} = line, spec, %CustomerOrder{} = primary) do
    expected_item_id = resolve_item_id(primary.company_id, spec.psp_finished_product_uuid)
    expected_qty = to_decimal(spec.quantity, Decimal.new(1))
    expected_price = to_decimal(spec.unit_price, Decimal.new(0))
    expected_combo_uuid = Map.get(spec, :packaging_combo_uuid)

    line.item_id == expected_item_id and
      Decimal.equal?(line.qty_ordered || Decimal.new(0), expected_qty) and
      Decimal.equal?(line.unit_price || Decimal.new(0), expected_price) and
      to_string(line.npd_packaging_combo_uuid || "") ==
        to_string(expected_combo_uuid || "")
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
      # Persist the customer's packaging combo pick so
      # ``customer_order_controller.create_mo_for_line`` can inject it
      # into the MO BOM. Nil on Custom orders and on any RTG payload
      # that predates the sender's ``packaging_combo_*`` fields.
      # Empty list on the items column is a legitimate state
      # ("customer picked the empty / no-packaging combo") — we keep
      # nil ONLY when the customer didn't pick a combo at all, so the
      # MO wizard can distinguish "use default packaging" from
      # "customer explicitly chose zero packaging".
      npd_packaging_combo_uuid: Map.get(spec, :packaging_combo_uuid),
      npd_packaging_combo_name:
        case Map.get(spec, :packaging_combo_name, "") do
          "" -> nil
          name -> name
        end,
      npd_packaging_combo_items:
        case {Map.get(spec, :packaging_combo_uuid),
              Map.get(spec, :packaging_combo_items, [])} do
          {nil, _} -> nil
          {_, items} -> items
        end,
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
            # NPD sends the customer's picked packaging combo alongside
            # every line — combo uuid + name + a self-contained list of
            # items (each ``{npd_item_uuid, psp_item_uuid, name,
            # quantity}``). We normalise the items down to string keys
            # so the JSONB round-trip is stable across Ecto versions
            # (mixed atom/string keys deserialise differently on
            # ``:map`` fields depending on the encoder).
            combo_uuid_raw =
              row["packaging_combo_uuid"] || row[:packaging_combo_uuid]

            combo_name =
              (row["packaging_combo_name"] || row[:packaging_combo_name] || "")
              |> to_string()

            combo_items_raw =
              row["packaging_combo_items"] || row[:packaging_combo_items] || []

            combo_items =
              combo_items_raw
              |> List.wrap()
              |> Enum.map(fn item ->
                %{
                  "npd_item_uuid" =>
                    to_string(item["npd_item_uuid"] || item[:npd_item_uuid] || ""),
                  "psp_item_uuid" =>
                    to_string(item["psp_item_uuid"] || item[:psp_item_uuid] || ""),
                  "name" => to_string(item["name"] || item[:name] || ""),
                  "quantity" =>
                    (item["quantity"] || item[:quantity] || 1)
                    |> normalise_combo_quantity()
                }
              end)
              |> Enum.reject(fn i ->
                # Drop rows that have neither a PSP nor NPD identifier
                # — nothing MO overlay can resolve.
                i["npd_item_uuid"] == "" and i["psp_item_uuid"] == ""
              end)

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
              line_subtotal: row["line_subtotal"] || row[:line_subtotal],
              packaging_combo_uuid: maybe_cast_uuid(combo_uuid_raw),
              packaging_combo_name: combo_name,
              packaging_combo_items: combo_items
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

  # Combo item quantities on NPD are positive integers (packaging is
  # always "N units of the pack per finished unit"). Normalise to an
  # integer so the JSONB payload has one shape regardless of whether
  # the sender picked int, float, string, or Decimal encoding.
  defp normalise_combo_quantity(v) when is_integer(v) and v > 0, do: v
  defp normalise_combo_quantity(v) when is_float(v) and v > 0, do: trunc(v)
  defp normalise_combo_quantity(v) when is_binary(v) do
    case Integer.parse(v) do
      {n, _} when n > 0 -> n
      _ -> 1
    end
  end
  defp normalise_combo_quantity(%Decimal{} = v) do
    case Decimal.to_integer(Decimal.round(v, 0, :down)) do
      n when n > 0 -> n
      _ -> 1
    end
  rescue
    _ -> 1
  end
  defp normalise_combo_quantity(_), do: 1
end
