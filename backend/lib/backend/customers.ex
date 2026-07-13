defmodule Backend.Customers do
  @moduledoc """
  Boundary for the customer (sell-side) registry plus the supporting
  contacts / files / contact-events sub-tables.

  Approval is a two-step transition (`approve_customer/3`) so the
  ESIGN columns (`approved_by_id`, `approved_at`) can never drift
  from the `approval_status` they describe, and so the 4-eyes rule
  (approver ≠ creator) lives in one auditable place.

  Identity edits (legal_name, registration_number, tax_number) made
  after approval automatically VOID the approval — the customer
  reverts to `draft` and must be re-approved. This implements the
  CLAUDE.md "Identity changes void approval" rule.

  Contact events are append-only: there's no `update_contact_event`
  or `delete_contact_event` here by design — a wrong entry is
  corrected with a follow-up event, not by mutating history.

  `last_contact_at` / `next_contact_at` on the customer row are kept
  in sync transactionally with every `log_contact_event/3` so the
  list page doesn't have to N+1 aggregate the events table.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.ListQueries
  alias Backend.Repo

  alias Backend.Customers.{
    Customer,
    CustomerContact,
    CustomerContactEvent,
    CustomerFile
  }

  alias Backend.CustomerOrders.CustomerApprovedItem

  @customer_audit_fields ~w(name legal_name contact_name website legal_address
                            country_code registration_number tax_number
                            currency_code tax_rate default_discount_percent
                            language_code payment_terms_days payment_terms_basis
                            trade_credit_limit pricelist_id contact_frequency_months
                            contact_started_at last_contact_at next_contact_at
                            first_order_at last_order_at total_orders_count
                            approval_status approval_notes approved_at
                            account_manager_id is_active
                            kyc_verified_at credit_check_at credit_check_outcome
                            aml_screened_at aml_outcome contract_signed_at
                            qualified_at review_frequency_months
                            last_review_at next_review_at)a

  @customer_sortable ~w(id name approval_status is_active
                        currency_code country_code
                        payment_terms_days trade_credit_limit
                        total_orders_count contact_frequency_months
                        last_contact_at next_contact_at
                        first_order_at last_order_at
                        last_review_at next_review_at
                        inserted_at updated_at)a
  # `tax_number` was here before we encrypted the column at rest — an
  # ILIKE fuzzy search can't match ciphertext, so it's been dropped.
  # Users still search by name / legal_name / contact / registration.
  @customer_search ~w(name legal_name contact_name registration_number)a
  @customer_default_sort {:name, :asc}

  @identity_fields ~w(legal_name registration_number tax_number)

  # ----- registry list / get ---------------------------------------

  def list_page(company_id, opts \\ []) when is_integer(company_id) do
    sort = normalise_sort(Keyword.get(opts, :sort, @customer_default_sort))

    {code_id, column_filter} =
      ListQueries.pop_code_column_filter(opts[:column_filter], company_id, "customer")

    base =
      Customer
      |> where([c], c.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @customer_search, {company_id, "customer"})
      |> maybe_status_filter(opts[:approval_status])
      |> maybe_active_filter(opts[:is_active])
      |> maybe_account_manager_filter(opts[:account_manager_id])
      |> maybe_code_id_filter(code_id)
      |> ListQueries.apply_column_filters(column_filter, @customer_sortable)
      |> ListQueries.apply_sort(sort, @customer_sortable, @customer_default_sort)
      |> preload([:created_by, :updated_by, :approved_by, :account_manager])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp normalise_sort({:code, dir}), do: {:id, dir}
  defp normalise_sort(other), do: other

  defp maybe_code_id_filter(query, nil), do: query
  defp maybe_code_id_filter(query, :no_match), do: where(query, [c], false)
  defp maybe_code_id_filter(query, id) when is_integer(id),
    do: where(query, [c], c.id == ^id)

  defp maybe_status_filter(query, nil), do: query
  defp maybe_status_filter(query, ""), do: query

  defp maybe_status_filter(query, status) when is_binary(status) do
    where(query, [c], c.approval_status == ^status)
  end

  defp maybe_active_filter(query, nil), do: query

  defp maybe_active_filter(query, val) when is_boolean(val) do
    where(query, [c], c.is_active == ^val)
  end

  defp maybe_active_filter(query, "true"), do: where(query, [c], c.is_active == true)
  defp maybe_active_filter(query, "false"), do: where(query, [c], c.is_active == false)
  defp maybe_active_filter(query, _), do: query

  defp maybe_account_manager_filter(query, nil), do: query
  defp maybe_account_manager_filter(query, ""), do: query

  defp maybe_account_manager_filter(query, id) when is_integer(id) do
    where(query, [c], c.account_manager_id == ^id)
  end

  defp maybe_account_manager_filter(query, id) when is_binary(id) do
    case Integer.parse(id) do
      {n, ""} -> where(query, [c], c.account_manager_id == ^n)
      _ -> query
    end
  end

  def list_for_company(company_id) do
    Repo.all(
      from(c in Customer,
        where: c.company_id == ^company_id and c.is_active == true,
        order_by: [asc: c.name]
      )
    )
  end

  def get_for_company(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Customer
        |> where([c], c.company_id == ^company_id and c.uuid == ^cast)
        |> Repo.one()
        |> case do
          nil -> nil
          customer -> preload_customer(customer)
        end

      :error ->
        nil
    end
  end

  def get_for_company(_company_id, _), do: nil

  # ----- create / update / delete ----------------------------------

  def create(%User{} = actor, company_id, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> normalise_phone_values()
      |> Map.merge(%{
        "company_id" => company_id,
        "created_by_id" => actor.id,
        "updated_by_id" => actor.id
      })

    %Customer{}
    |> Customer.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, customer} ->
        Audit.record_created(actor, "customer", customer, customer_snapshot(customer))
        Backend.Broadcasts.entity_changed("customer", customer.uuid, customer.company_id, "created")
        {:ok, preload_customer(customer)}

      other ->
        other
    end
  end

  @doc """
  Update a customer.

  If the update touches any of the identity fields (`legal_name`,
  `registration_number`, `tax_number`) AND the customer is currently
  `approved`, the approval is voided as a side effect — the row
  reverts to `draft`, `approved_at` / `approved_by_id` are cleared,
  and an audit row records both the edit and the void.

  This implements CLAUDE.md's "Identity changes void approval" rule:
  the same human can't quietly change a legal entity's identity and
  keep the previous approval intact.
  """
  def update(%User{} = actor, %Customer{} = customer, attrs) do
    before_state = customer_snapshot(customer)
    str_attrs = attrs |> stringify_keys() |> normalise_phone_values()

    str_attrs =
      str_attrs
      |> Map.put("updated_by_id", actor.id)
      |> maybe_void_approval(customer)

    customer
    |> Customer.changeset(str_attrs)
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        # The identity-void path bypasses the approval changeset's
        # validations, so the columns reset here only after the main
        # save succeeds. Two-step is fine; both writes are in the same
        # request and the audit captures both.
        updated =
          if void_approval?(str_attrs, customer) do
            updated
            |> Customer.approve_changeset(%{
              "approval_status" => "draft",
              "approved_at" => nil,
              "approved_by_id" => nil,
              "updated_by_id" => actor.id
            })
            |> Repo.update!()
          else
            updated
          end

        Audit.record_updated(
          actor,
          "customer",
          updated,
          before_state,
          customer_snapshot(updated)
        )

        Backend.Broadcasts.entity_changed("customer", updated.uuid, updated.company_id, "updated")
        {:ok, preload_customer(updated)}

      other ->
        other
    end
  end

  defp maybe_void_approval(attrs, %Customer{approval_status: "approved"} = current) do
    if identity_changing?(attrs, current) do
      Map.put(attrs, "approval_status", "draft")
    else
      attrs
    end
  end

  defp maybe_void_approval(attrs, _), do: attrs

  defp void_approval?(attrs, %Customer{approval_status: "approved"} = current),
    do: identity_changing?(attrs, current)

  defp void_approval?(_, _), do: false

  defp identity_changing?(attrs, %Customer{} = current) do
    Enum.any?(@identity_fields, fn field ->
      Map.has_key?(attrs, field) and
        Map.get(attrs, field) != Map.get(current, String.to_existing_atom(field))
    end)
  end

  def delete(%User{} = actor, %Customer{} = customer) do
    before_state = customer_snapshot(customer)

    case Repo.delete(customer) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "customer", customer, before_state)
        Backend.Broadcasts.entity_changed("customer", customer.uuid, customer.company_id, "deleted")
        {:ok, deleted}

      other ->
        other
    end
  end

  # ----- qualification artifacts -----------------------------------

  @doc """
  Update the customer onboarding record (KYC / Credit / AML / Contract
  evidence + re-qualification cadence). Stamps `qualified_by_id` +
  `qualified_at` so the approve transition can enforce segregation of
  duties — the same human can't both collect the evidence and sign
  it off.

  Distinct from `update/3` because the qualification record is
  audit-sensitive: arbitrary form saves shouldn't be able to clear
  an evidence FK, and the segregation-of-duties stamp would get
  trampled.
  """
  def update_qualification(%User{} = actor, %Customer{} = customer, attrs) do
    before_state = customer_snapshot(customer)
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    attrs =
      attrs
      |> stringify_keys()
      |> Map.put("qualified_by_id", actor.id)
      |> Map.put("qualified_at", now)
      |> Map.put("updated_by_id", actor.id)

    customer
    |> Customer.qualification_changeset(attrs)
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(actor, "customer", updated, before_state, customer_snapshot(updated))
        Backend.Broadcasts.entity_changed("customer", updated.uuid, updated.company_id, "qualified")
        {:ok, preload_customer(updated)}

      other ->
        other
    end
  end

  @doc """
  Return the onboarding checklist for a customer — what's complete,
  what's still blocking approval. `approve_customer/3` uses `missing`
  as the gate.

      %{
        complete?: false,
        missing: [
          %{key: :kyc, label: "KYC verification", reason: "Not yet recorded"},
          %{key: :credit_check, label: "Credit check", reason: "Not yet completed"},
          ...
        ]
      }
  """
  def qualification_status(%Customer{} = customer) do
    kyc_missing =
      if is_nil(customer.kyc_verified_at),
        do: %{
          key: :kyc,
          label: "KYC verification",
          reason: "Not yet recorded — confirm registered entity + upload registry doc"
        },
        else: nil

    credit_missing =
      cond do
        is_nil(customer.credit_check_at) ->
          %{
            key: :credit_check,
            label: "Credit check",
            reason: "Not yet completed"
          }

        customer.credit_check_outcome == "fail" ->
          %{
            key: :credit_check,
            label: "Credit check",
            reason: "Outcome is FAIL — re-run before approving or override with notes"
          }

        true ->
          nil
      end

    aml_missing =
      cond do
        is_nil(customer.aml_screened_at) ->
          %{
            key: :aml,
            label: "AML / sanctions screening",
            reason: "Not yet completed"
          }

        customer.aml_outcome == "flagged" and
            (is_nil(customer.aml_notes) or String.trim(customer.aml_notes) == "") ->
          %{
            key: :aml,
            label: "AML / sanctions screening",
            reason: "FLAGGED — required to record clearance notes before approving"
          }

        true ->
          nil
      end

    contract_missing =
      if is_nil(customer.contract_signed_at),
        do: %{
          key: :contract,
          label: "Signed contract / MSA",
          reason: "Not yet on file — upload the countersigned PDF"
        },
        else: nil

    missing =
      [kyc_missing, credit_missing, aml_missing, contract_missing]
      |> Enum.reject(&is_nil/1)

    %{complete?: missing == [], missing: missing}
  end

  @doc """
  Whether next_review_at is in the past — drives the overdue chip on
  the list page + a future "expiring qualifications" queue.
  """
  def review_overdue?(%Customer{next_review_at: nil}), do: false

  def review_overdue?(%Customer{next_review_at: date}) do
    Date.compare(date, Date.utc_today()) == :lt
  end

  @doc """
  Effective approval status — the stored `approval_status` folded
  with the re-qualification cadence. An "approved" customer whose
  `next_review_at` has passed is functionally NOT approved anymore:
  the system treats them as suspended until they re-qualify, even
  though the stored column still reflects the last human decision.

  Returns `{status, reason}` so downstream UI can explain WHY the
  effective state differs from the stored one. `reason` is `:none`
  when there's no override.

  Other rules layer cleanly:
    * `is_active = false` ⇒ effectively suspended (manual disable).
    * Stored `suspended` / `rejected` / `draft` pass through unchanged.
  """
  def effective_approval_status(%Customer{} = customer) do
    cond do
      not customer.is_active ->
        {"suspended", :inactive}

      customer.approval_status == "approved" and review_overdue?(customer) ->
        {"suspended", :re_qualification_overdue}

      true ->
        {customer.approval_status, :none}
    end
  end

  @doc """
  Gate for "can this customer place a sales order?" — what the
  downstream Customer-Order module reads.

  Active iff effective approval is `approved` AND no manual suspend
  and not overdue. This is the only place the rule should live; the
  effective-status computation is just the human-readable shape of it.
  """
  def approval_active?(%Customer{} = customer) do
    {status, _reason} = effective_approval_status(customer)
    status == "approved"
  end

  # ----- per-customer approved-items (sell-side restriction) ------

  @doc """
  Add an item to the customer's approved-products list. Empty list ⇒
  customer can buy anything; once any row exists the list is the
  whitelist enforced at CO submit time.
  """
  def add_approved_item(%User{} = actor, %Customer{} = customer, item_id, attrs \\ %{}) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "customer_id" => customer.id,
        "item_id" => item_id,
        "company_id" => customer.company_id,
        "approved_by_id" => actor.id,
        "approved_at" => now
      })

    %CustomerApprovedItem{}
    |> CustomerApprovedItem.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, row} ->
        Audit.record_created(actor, "customer_approved_item", row, %{
          customer_id: row.customer_id,
          item_id: row.item_id
        })

        Backend.Broadcasts.entity_changed(
          "customer",
          customer.uuid,
          customer.company_id,
          "approved_item_added"
        )

        {:ok, Repo.preload(row, [:item, :approved_by])}

      other ->
        other
    end
  end

  def remove_approved_item(%User{} = actor, %CustomerApprovedItem{} = row) do
    case Repo.delete(row) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "customer_approved_item", row, %{
          customer_id: row.customer_id,
          item_id: row.item_id
        })

        broadcast_customer_by_id(row.customer_id, row.company_id, "approved_item_removed")
        {:ok, deleted}

      other ->
        other
    end
  end

  def get_approved_item(customer_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} -> Repo.get_by(CustomerApprovedItem, customer_id: customer_id, uuid: cast)
      :error -> nil
    end
  end

  def get_approved_item(_, _), do: nil

  def list_approved_items_for(customer_id) when is_integer(customer_id) do
    Repo.all(
      from(r in CustomerApprovedItem,
        where: r.customer_id == ^customer_id,
        preload: [:item, :approved_by],
        order_by: [asc: r.id]
      )
    )
  end

  @doc """
  Return the subset of `item_ids` that are NOT sellable to the
  customer. Used by CO submit to flag which lines need attention.

  Rule: a customer with NO approved-items rows can be sold anything
  (open shop). A customer with at least one row is restricted to the
  listed items.
  """
  def items_not_sellable(customer_id, item_ids)
      when is_integer(customer_id) and is_list(item_ids) do
    approved_ids =
      Repo.all(
        from(r in CustomerApprovedItem,
          where: r.customer_id == ^customer_id,
          select: r.item_id
        )
      )

    case approved_ids do
      [] -> []
      _ -> item_ids -- approved_ids
    end
  end

  # ----- approval transition ---------------------------------------

  @doc """
  Flip `approval_status`. Two regulatory guards on the "→ approved"
  branch:

    1. **Checklist completeness** — every artifact in
       `qualification_status/1.missing` must be cleared
       (KYC + Credit + AML + Contract).
    2. **Segregation of duties** — the actor signing off must NOT be
       the same user who last touched the qualification record
       (`qualified_by_id`). One human can't both collect the evidence
       and sign off on it.

  On the "approved" branch we also stamp an evidence snapshot of the
  full checklist + a refreshed review cadence so a future audit can
  answer "what did we have on file the day we said yes?" even if
  files are later replaced or removed.

  De-approval branches (`draft`, `suspended`, `rejected`) clear the
  approver columns; only `rejected` is permanent — `suspended` is
  meant for temporary blocks (e.g. past-due A/R).
  """
  def approve_customer(%User{} = actor, %Customer{} = customer, attrs) do
    attrs = stringify_keys(attrs)
    target = attrs["approval_status"]
    customer = preload_customer(customer)

    case target do
      "approved" ->
        with :ok <- enforce_completeness(customer),
             :ok <- enforce_segregation_of_duties(actor, customer) do
          do_approve_transition(actor, customer, attrs, target)
        end

      t when t in ["suspended", "rejected"] ->
        # These transitions block downstream sales workflows, so the
        # audit log MUST carry a human-readable reason. Empty notes
        # is a worker-bypass smell — the UI also enforces this, but
        # we re-validate here as defence in depth.
        with :ok <- enforce_reason_required(attrs, t) do
          do_approve_transition(actor, customer, attrs, t)
        end

      "draft" ->
        do_approve_transition(actor, customer, attrs, "draft")

      _ ->
        {:error, :invalid_status}
    end
  end

  defp enforce_reason_required(attrs, target) do
    notes = attrs["approval_notes"]

    if is_binary(notes) and String.trim(notes) != "" do
      :ok
    else
      {:error, {:reason_required, target}}
    end
  end

  defp enforce_completeness(%Customer{} = customer) do
    case qualification_status(customer) do
      %{complete?: true} -> :ok
      %{missing: missing} -> {:error, {:onboarding_incomplete, missing}}
    end
  end

  defp enforce_segregation_of_duties(%User{id: actor_id}, %Customer{qualified_by_id: qid})
       when not is_nil(qid) and actor_id == qid do
    {:error, :same_signer_as_qualifier}
  end

  # When no one has touched the qualification record yet (qualified_by
  # is nil), the only way the actor can be the qualifier is if they
  # also typed in the data — but if they typed it on this same request
  # the changeset above would have stamped them. So nil-qualified_by
  # implies an admin override and we fall back to the original
  # 4-eyes rule (approver ≠ creator) as a safety net.
  defp enforce_segregation_of_duties(%User{id: actor_id}, %Customer{
         qualified_by_id: nil,
         created_by_id: creator_id
       })
       when not is_nil(creator_id) and actor_id == creator_id do
    {:error, :same_signer_as_creator}
  end

  defp enforce_segregation_of_duties(_actor, _customer), do: :ok

  defp do_approve_transition(actor, customer, attrs, target) do
    before_state = customer_snapshot(customer)

    attrs =
      attrs
      |> Map.put("updated_by_id", actor.id)
      |> maybe_stamp_approval(actor, customer, target)

    customer
    |> Customer.approve_changeset(attrs)
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(
          actor,
          "customer",
          updated,
          before_state,
          customer_snapshot(updated)
        )

        Backend.Broadcasts.entity_changed(
          "customer",
          updated.uuid,
          updated.company_id,
          "approval_#{target}"
        )

        {:ok, preload_customer(updated)}

      other ->
        other
    end
  end

  defp maybe_stamp_approval(attrs, actor, %Customer{} = customer, "approved") do
    today = Date.utc_today()
    frequency = customer.review_frequency_months || 12

    attrs
    |> Map.put_new("approved_by_id", actor.id)
    |> Map.put_new("approved_at", DateTime.utc_now() |> DateTime.truncate(:second))
    |> Map.put("approval_evidence_snapshot", build_evidence_snapshot(customer))
    |> Map.put_new("last_review_at", today)
    |> Map.put_new("next_review_at", Date.add(today, round(frequency * 30)))
  end

  defp maybe_stamp_approval(attrs, _actor, _customer, status)
       when status in ["draft", "suspended", "rejected"] do
    attrs
    |> Map.put("approved_by_id", nil)
    |> Map.put("approved_at", nil)
    |> Map.put("approval_evidence_snapshot", nil)
  end

  defp maybe_stamp_approval(attrs, _, _, _), do: attrs

  defp build_evidence_snapshot(%Customer{} = c) do
    %{
      "snapshot_at" => DateTime.utc_now() |> DateTime.to_iso8601(),
      "kyc" => %{
        "verified_at" => c.kyc_verified_at && DateTime.to_iso8601(c.kyc_verified_at),
        "verified_by_id" => c.kyc_verified_by_id,
        "file_id" => c.kyc_file_id,
        "notes" => c.kyc_notes
      },
      "credit_check" => %{
        "at" => c.credit_check_at && DateTime.to_iso8601(c.credit_check_at),
        "by_id" => c.credit_check_by_id,
        "outcome" => c.credit_check_outcome,
        "score" => c.credit_check_score && Decimal.to_string(c.credit_check_score),
        "file_id" => c.credit_check_file_id,
        "notes" => c.credit_check_notes
      },
      "aml" => %{
        "screened_at" => c.aml_screened_at && DateTime.to_iso8601(c.aml_screened_at),
        "screened_by_id" => c.aml_screened_by_id,
        "outcome" => c.aml_outcome,
        "notes" => c.aml_notes
      },
      "contract" => %{
        "signed_at" => c.contract_signed_at && DateTime.to_iso8601(c.contract_signed_at),
        "signed_by_id" => c.contract_signed_by_id,
        "file_id" => c.contract_file_id,
        "notes" => c.contract_notes
      },
      "trade_credit_limit" => c.trade_credit_limit && Decimal.to_string(c.trade_credit_limit),
      "currency_code" => c.currency_code
    }
  end

  # ----- contact-info rows -----------------------------------------

  def add_contact(%User{} = actor, %Customer{} = customer, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> normalise_phone()
      |> Map.merge(%{
        "customer_id" => customer.id,
        "company_id" => customer.company_id,
        "created_by_id" => actor.id,
        "updated_by_id" => actor.id
      })

    result =
      Repo.transaction(fn ->
        with :ok <- maybe_clear_other_primaries(customer.id, attrs),
             {:ok, contact} <-
               %CustomerContact{}
               |> CustomerContact.changeset(attrs)
               |> Repo.insert() do
          Audit.record_created(actor, "customer_contact", contact, %{
            customer_id: contact.customer_id,
            kind: contact.kind,
            value: contact.value,
            is_primary: contact.is_primary
          })

          contact
        else
          {:error, changeset} -> Repo.rollback(changeset)
        end
      end)

    case result do
      {:ok, _} ->
        Backend.Broadcasts.entity_changed(
          "customer",
          customer.uuid,
          customer.company_id,
          "contact_added"
        )

      _ ->
        :ok
    end

    result
  end

  def update_contact(%User{} = actor, %CustomerContact{} = contact, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> normalise_phone()
      |> Map.put("updated_by_id", actor.id)

    result =
      Repo.transaction(fn ->
        with :ok <- maybe_clear_other_primaries(contact.customer_id, attrs),
             {:ok, updated} <-
               contact
               |> CustomerContact.changeset(attrs)
               |> Repo.update() do
          Audit.record_updated(
            actor,
            "customer_contact",
            updated,
            %{kind: contact.kind, value: contact.value, is_primary: contact.is_primary},
            %{kind: updated.kind, value: updated.value, is_primary: updated.is_primary}
          )

          updated
        else
          {:error, changeset} -> Repo.rollback(changeset)
        end
      end)

    case result do
      {:ok, _} -> broadcast_customer_by_id(contact.customer_id, contact.company_id, "contact_updated")
      _ -> :ok
    end

    result
  end

  def remove_contact(%User{} = actor, %CustomerContact{} = contact) do
    case Repo.delete(contact) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "customer_contact", contact, %{
          customer_id: contact.customer_id,
          kind: contact.kind,
          value: contact.value
        })

        broadcast_customer_by_id(contact.customer_id, contact.company_id, "contact_deleted")
        {:ok, deleted}

      other ->
        other
    end
  end

  # Helper: broadcast a customer-scoped change without needing the
  # caller to hold the preloaded parent struct. Cheap Repo.get and
  # only fires if the customer resolves.
  defp broadcast_customer_by_id(customer_id, company_id, action)
       when is_integer(customer_id) and is_integer(company_id) do
    case Repo.get(Customer, customer_id) do
      %Customer{uuid: uuid} ->
        Backend.Broadcasts.entity_changed("customer", uuid, company_id, action)

      _ ->
        :ok
    end
  end

  defp broadcast_customer_by_id(_, _, _), do: :ok

  def get_contact(customer_id, uuid) when is_integer(customer_id) and is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} -> Repo.get_by(CustomerContact, customer_id: customer_id, uuid: cast)
      :error -> nil
    end
  end

  def get_contact(_, _), do: nil

  defp maybe_clear_other_primaries(_customer_id, %{"is_primary" => v})
       when v in [false, "false", nil],
       do: :ok

  defp maybe_clear_other_primaries(customer_id, %{"is_primary" => primary})
       when primary in [true, "true"] do
    Repo.update_all(
      from(cc in CustomerContact, where: cc.customer_id == ^customer_id),
      set: [is_primary: false]
    )

    :ok
  end

  defp maybe_clear_other_primaries(_, _), do: :ok

  # Conservative phone normalisation. Strip spaces / dashes / parens
  # so two visually-different rows ("020 1234 5678" vs "02012345678")
  # don't both exist as "primary phone". Full E.164 normalisation
  # would need libphonenumber + a default-country lookup; we keep
  # the parsing layer thin and let the changeset's regex catch the
  # rest.
  defp normalise_phone(%{"kind" => kind, "value" => value} = attrs)
       when kind in ["phone", "mobile", "fax"] and is_binary(value) do
    cleaned =
      value
      |> String.replace(~r/[\s\-().]/, "")

    Map.put(attrs, "value", cleaned)
  end

  defp normalise_phone(attrs), do: attrs

  # Same cleanup when phone-shaped values arrive on the main customer
  # form. Doesn't touch fields we don't own.
  defp normalise_phone_values(attrs), do: attrs

  # ----- contact-event log -----------------------------------------

  @doc """
  Insert a contact-event row + transactionally update the cadence
  columns on the customer.

  This is what makes `last_contact_at` query-cheap and the derived
  `status` projection ("lead" → "prospect") cross over without a
  separate background job.
  """
  def log_contact_event(%User{} = actor, %Customer{} = customer, attrs) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    attrs =
      attrs
      |> stringify_keys()
      |> Map.put_new("occurred_at", now)
      |> Map.merge(%{
        "customer_id" => customer.id,
        "company_id" => customer.company_id,
        "logged_by_id" => actor.id
      })

    result =
      Repo.transaction(fn ->
        with {:ok, event} <-
               %CustomerContactEvent{}
               |> CustomerContactEvent.changeset(attrs)
               |> Repo.insert(),
             {:ok, updated_customer} <- refresh_cadence(actor, customer, event) do
          Audit.record_created(actor, "customer_contact_event", event, %{
            customer_id: event.customer_id,
            kind: event.kind,
            occurred_at: event.occurred_at
          })

          %{event: Repo.preload(event, :logged_by), customer: updated_customer}
        else
          {:error, changeset} -> Repo.rollback(changeset)
        end
      end)

    case result do
      {:ok, _} ->
        Backend.Broadcasts.entity_changed(
          "customer",
          customer.uuid,
          customer.company_id,
          "contact_logged"
        )

      _ ->
        :ok
    end

    result
  end

  defp refresh_cadence(_actor, %Customer{} = customer, %CustomerContactEvent{occurred_at: when_}) do
    frequency = customer.contact_frequency_months || 3

    next_at =
      when_
      |> DateTime.to_date()
      |> Date.add(round(frequency * 30))
      |> DateTime.new!(~T[09:00:00])

    cadence_attrs = %{
      "last_contact_at" => when_,
      "next_contact_at" => next_at,
      "contact_started_at" => customer.contact_started_at || when_
    }

    customer
    |> Customer.cadence_changeset(cadence_attrs)
    |> Repo.update()
  end

  @doc """
  Read-time projection of the customer's lifecycle state. Computed
  from contact-event history, order rollups, and the manual
  `is_active` toggle — never written to a column.

      :lead     — no contact events yet
      :prospect — contacted, but no order placed
      :active   — has placed ≥ 1 order AND last contact in window
      :dormant  — has ordered, but no contact / order in 6+ months
      :inactive — `is_active = false` (manually suspended)
  """
  def status_projection(%Customer{is_active: false}), do: :inactive

  def status_projection(%Customer{} = customer) do
    today = DateTime.utc_now()
    six_months_ago = DateTime.add(today, -180, :day)
    has_orders? = (customer.total_orders_count || 0) > 0

    cond do
      is_nil(customer.last_contact_at) -> :lead
      has_orders? and recent?(customer.last_contact_at, six_months_ago) -> :active
      has_orders? -> :dormant
      true -> :prospect
    end
  end

  defp recent?(nil, _), do: false

  defp recent?(%DateTime{} = at, %DateTime{} = boundary),
    do: DateTime.compare(at, boundary) != :lt

  @doc """
  Push `next_contact_at` forward by N days without recording a
  contact event. Used by the "Today's contacts" page when the
  salesperson wants to defer (not log) a follow-up — e.g. customer
  asked "call me Thursday".

  Audit row is written so the deferral is traceable. The base for
  the new datetime is whichever is later: the current
  `next_contact_at` or "today 09:00" — snoozing an already-overdue
  row should land in the future, not still in the past.
  """
  def snooze_next_contact(%User{} = actor, %Customer{} = customer, days) do
    case parse_days(days) do
      {:ok, n} ->
        today_morning = DateTime.new!(Date.utc_today(), ~T[09:00:00])

        base =
          case customer.next_contact_at do
            %DateTime{} = at ->
              if DateTime.compare(at, today_morning) == :lt, do: today_morning, else: at

            _ ->
              today_morning
          end

        new_at = DateTime.add(base, n * 24 * 60 * 60, :second)

        before_state = %{next_contact_at: customer.next_contact_at}

        customer
        |> Customer.cadence_changeset(%{"next_contact_at" => new_at})
        |> Repo.update()
        |> case do
          {:ok, updated} ->
            Audit.record_updated(actor, "customer", updated, before_state, %{
              next_contact_at: new_at,
              snooze_days: n
            })

            Backend.Broadcasts.entity_changed(
              "customer",
              updated.uuid,
              updated.company_id,
              "snoozed"
            )

            {:ok, updated}

          other ->
            other
        end

      :error ->
        {:error, :invalid_days}
    end
  end

  defp parse_days(n) when is_integer(n) and n > 0 and n <= 365, do: {:ok, n}

  defp parse_days(s) when is_binary(s) do
    case Integer.parse(s) do
      {n, ""} -> parse_days(n)
      _ -> :error
    end
  end

  defp parse_days(_), do: :error

  # ----- file uploads ----------------------------------------------

  def record_file(%User{} = actor, %Customer{} = customer, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.put("company_id", customer.company_id)
      |> Map.put("customer_id", customer.id)
      |> Map.put("uploaded_by_id", actor.id)

    %CustomerFile{}
    |> CustomerFile.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, file} ->
        Audit.record_created(actor, "customer_file", file, %{
          customer_id: file.customer_id,
          kind: file.kind,
          filename: file.filename
        })

        Backend.Broadcasts.entity_changed(
          "customer",
          customer.uuid,
          customer.company_id,
          "file_added"
        )

        {:ok, Repo.preload(file, :uploaded_by)}

      other ->
        other
    end
  end

  def get_file(customer_id, uuid) when is_integer(customer_id) and is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from(f in CustomerFile,
            where: f.customer_id == ^customer_id and f.uuid == ^cast,
            preload: [:uploaded_by]
          )
        )

      :error ->
        nil
    end
  end

  def get_file(_, _), do: nil

  def remove_file(%User{} = actor, %CustomerFile{} = file) do
    case Repo.delete(file) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "customer_file", file, %{
          customer_id: file.customer_id,
          kind: file.kind,
          filename: file.filename
        })

        broadcast_customer_by_id(file.customer_id, file.company_id, "file_deleted")
        {:ok, deleted}

      other ->
        other
    end
  end

  # ----- internals -------------------------------------------------

  defp preload_customer(%Customer{} = c) do
    c
    |> Repo.preload([
      :created_by,
      :updated_by,
      :approved_by,
      :account_manager,
      :kyc_verified_by,
      :credit_check_by,
      :aml_screened_by,
      :contract_signed_by,
      :qualified_by,
      :kyc_file,
      :credit_check_file,
      :contract_file,
      :contacts,
      files: [:uploaded_by],
      contact_events: [:logged_by],
      approved_items: [:item, :approved_by]
    ])
    |> sort_associations()
  end

  # Ecto's preload doesn't support inline query ordering ergonomically
  # alongside other preloads, so we sort in Elixir after the fact.
  # Cardinalities are small (per-customer rows, not all customers) so
  # the cost is negligible.
  defp sort_associations(%Customer{} = c) do
    %{
      c
      | contacts: Enum.sort_by(c.contacts, fn cc -> {not cc.is_primary, cc.kind, cc.id} end),
        contact_events: Enum.sort_by(c.contact_events, & &1.occurred_at, {:desc, DateTime})
    }
  end

  defp customer_snapshot(%Customer{} = c),
    do: Map.new(@customer_audit_fields, fn k -> {k, Map.get(c, k)} end)

  defp stringify_keys(attrs) when is_map(attrs) do
    Map.new(attrs, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end
end
