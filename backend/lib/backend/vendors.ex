defmodule Backend.Vendors do
  @moduledoc """
  Boundary for the vendor (supplier) registry, the per-item
  approved-supplier list, and the per-vendor certificate
  attachments.

  Approval is a two-step transition rather than a `vendor.update` —
  callers go through `approve_vendor/3` so the ESIGN columns
  (`approved_by_id`, `approved_at`) can never drift from the
  `approval_status` they describe.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.ListQueries
  alias Backend.Repo
  alias Backend.Vendors.{ApprovedItem, Vendor, VendorCertificate, VendorFile}

  @vendor_audit_fields ~w(name legal_name email phone website contact_name legal_address
                          registration_number tax_number tax_rate currency_code
                          default_lead_time_days payment_terms_days payment_basis
                          supply_chain_type vendor_risk product_types
                          questionnaire_status traceability_verification_status
                          review_frequency_months last_review_at next_review_at
                          approval_status approval_notes approved_at notes is_active
                          saq_received_at risk_assessment_completed_at audit_required
                          audit_completed_at audit_kind audit_outcome
                          coa_received_at qualified_at)a
  # `tax_number` removed from the sortable list — SQL ORDER BY on
  # ciphertext orders by encrypted bytes, which is meaningless. Every
  # other identity column is still sortable.
  @vendor_sortable ~w(id name legal_name email phone registration_number
                      currency_code default_lead_time_days payment_terms_days
                      supply_chain_type vendor_risk approval_status
                      questionnaire_status traceability_verification_status
                      review_frequency_months last_review_at next_review_at
                      is_active inserted_at updated_at)a
  # `tax_number` was here before we encrypted the column at rest — an
  # ILIKE fuzzy search can't match ciphertext, so it's been dropped.
  # Users still search by name / legal_name / email / contact /
  # registration_number / notes; if you need to look up a vendor by
  # exact tax number, the API accepts `column_filter[tax_number]=…`
  # against the plaintext-in-memory struct.
  @vendor_search ~w(name legal_name email contact_name registration_number notes)a
  @vendor_default_sort {:name, :asc}

  # ----- registry list / get ---------------------------------------

  def list_page(company_id, opts \\ []) when is_integer(company_id) do
    sort = normalise_sort(Keyword.get(opts, :sort, @vendor_default_sort))

    base =
      Vendor
      |> where([v], v.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @vendor_search)
      |> maybe_status_filter(opts[:approval_status])
      |> maybe_risk_filter(opts[:vendor_risk])
      |> maybe_active_filter(opts[:is_active])
      |> ListQueries.apply_column_filters(opts[:column_filter], @vendor_sortable)
      |> ListQueries.apply_sort(sort, @vendor_sortable, @vendor_default_sort)
      |> preload([:created_by, :updated_by, :approved_by])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp normalise_sort({:code, dir}), do: {:id, dir}
  defp normalise_sort(other), do: other

  defp maybe_status_filter(query, nil), do: query
  defp maybe_status_filter(query, ""), do: query

  defp maybe_status_filter(query, status) when is_binary(status) do
    where(query, [v], v.approval_status == ^status)
  end

  defp maybe_risk_filter(query, nil), do: query
  defp maybe_risk_filter(query, ""), do: query

  defp maybe_risk_filter(query, risk) when is_binary(risk) do
    where(query, [v], v.vendor_risk == ^risk)
  end

  defp maybe_active_filter(query, nil), do: query

  defp maybe_active_filter(query, val) when is_boolean(val) do
    where(query, [v], v.is_active == ^val)
  end

  defp maybe_active_filter(query, "true"), do: where(query, [v], v.is_active == true)
  defp maybe_active_filter(query, "false"), do: where(query, [v], v.is_active == false)
  defp maybe_active_filter(query, _), do: query

  def list_for_company(company_id) do
    Repo.all(
      from(v in Vendor,
        where: v.company_id == ^company_id and v.is_active == true,
        order_by: [asc: v.name]
      )
    )
  end

  def get_for_company(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from(v in Vendor,
            where: v.company_id == ^company_id and v.uuid == ^cast,
            preload: [
              :created_by,
              :updated_by,
              :approved_by,
              :qualified_by,
              :saq_file,
              :audit_file,
              :coa_file,
              approved_items: [:item, :approved_by],
              certificates: [:certificate, :uploaded_by, :document_file]
            ]
          )
        )

      :error ->
        nil
    end
  end

  def get_for_company(_company_id, _), do: nil

  # ----- create / update -------------------------------------------

  def create(%User{} = actor, company_id, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "company_id" => company_id,
        "created_by_id" => actor.id,
        "updated_by_id" => actor.id
      })

    %Vendor{}
    |> Vendor.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, vendor} ->
        Audit.record_created(actor, "vendor", vendor, vendor_snapshot(vendor))
        Backend.Broadcasts.entity_changed("vendor", vendor.uuid, vendor.company_id, "created")
        {:ok, preload_vendor(vendor)}

      other ->
        other
    end
  end

  def update(%User{} = actor, %Vendor{} = vendor, attrs) do
    before_state = vendor_snapshot(vendor)

    vendor
    |> Vendor.changeset(
      attrs |> stringify_keys() |> Map.put("updated_by_id", actor.id)
    )
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(
          actor,
          "vendor",
          updated,
          before_state,
          vendor_snapshot(updated)
        )

        Backend.Broadcasts.entity_changed("vendor", updated.uuid, updated.company_id, "updated")
        {:ok, preload_vendor(updated)}

      other ->
        other
    end
  end

  def delete(%User{} = actor, %Vendor{} = vendor) do
    before_state = vendor_snapshot(vendor)

    case Repo.delete(vendor) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "vendor", vendor, before_state)
        Backend.Broadcasts.entity_changed("vendor", vendor.uuid, vendor.company_id, "deleted")
        {:ok, deleted}

      other ->
        other
    end
  end

  # ----- qualification artifacts -----------------------------------

  @doc """
  Update the qualification record (SAQ / risk-assessment / audit /
  COA dates + document URLs). Stamps `qualified_by_id` + `qualified_at`
  so the approve transition can enforce segregation of duties.

  This is a separate context entry-point from `update/3` because the
  qualification record is audit-sensitive and we want a distinct
  permission gate on it downstream.
  """
  def update_qualification(%User{} = actor, %Vendor{} = vendor, attrs) do
    before_state = vendor_snapshot(vendor)
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    attrs =
      attrs
      |> stringify_keys()
      |> Map.put("qualified_by_id", actor.id)
      |> Map.put("qualified_at", now)
      |> Map.put("updated_by_id", actor.id)

    vendor
    |> Vendor.qualification_changeset(attrs)
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(actor, "vendor", updated, before_state, vendor_snapshot(updated))
        Backend.Broadcasts.entity_changed("vendor", updated.uuid, updated.company_id, "qualified")
        {:ok, preload_vendor(updated)}

      other ->
        other
    end
  end

  @doc """
  Return the qualification checklist for a vendor — what's complete,
  what's still blocking approval. The `approve_vendor/3` action uses
  `missing` as the gate.

      %{
        complete?: false,
        missing: [
          %{key: :saq, label: "Supplier Approval Questionnaire", reason: "Not yet received"},
          %{key: :audit, label: "Facility audit", reason: "Required for medium-/high-risk vendor"},
          %{key: :cert, label: "QMS certificate", reason: "No current GMP / BRC / FSSC / ISO 22000 on file"}
        ]
      }
  """
  def qualification_status(%Vendor{} = vendor) do
    v = preload_vendor(vendor)
    today = Date.utc_today()

    saq_missing =
      if is_nil(v.saq_received_at),
        do: %{key: :saq, label: "Supplier Approval Questionnaire", reason: "Not yet received"},
        else: nil

    risk_missing =
      cond do
        is_nil(v.risk_assessment_completed_at) ->
          %{
            key: :risk_assessment,
            label: "Risk assessment",
            reason: "Not completed"
          }

        is_nil(v.vendor_risk) ->
          %{
            key: :risk_class,
            label: "Risk class",
            reason: "Set low / medium / high on the vendor before approving"
          }

        true ->
          nil
      end

    audit_missing =
      cond do
        v.audit_required and is_nil(v.audit_completed_at) ->
          %{
            key: :audit,
            label: "Facility audit",
            reason: "Required for #{v.vendor_risk || "this"}-risk vendor"
          }

        v.audit_required and v.audit_outcome == "fail" ->
          %{
            key: :audit,
            label: "Facility audit",
            reason: "Last audit outcome is FAIL — re-audit before approving"
          }

        true ->
          nil
      end

    cert_missing =
      if Enum.any?(v.certificates, fn c ->
           is_nil(c.valid_until) or Date.compare(c.valid_until, today) == :gt
         end) do
        nil
      else
        %{
          key: :cert,
          label: "QMS certificate",
          reason: "At least one valid certificate (GMP / BRC / FSSC / ISO 22000 / equivalent) must be on file"
        }
      end

    review_window_missing =
      if is_nil(v.review_frequency_months) do
        %{
          key: :review_cadence,
          label: "Re-qualification cadence",
          reason: "Set how often this vendor must be re-reviewed (months)"
        }
      else
        nil
      end

    next_review_missing =
      if is_nil(v.next_review_at) do
        %{
          key: :next_review_at,
          label: "Next review date",
          reason: "Set the date of the next periodic re-qualification"
        }
      else
        nil
      end

    missing =
      [saq_missing, risk_missing, audit_missing, cert_missing, review_window_missing, next_review_missing]
      |> Enum.reject(&is_nil/1)

    %{complete?: missing == [], missing: missing}
  end

  @doc """
  Whether the next-review date is in the past — used by a periodic
  job to auto-suspend overdue vendors.
  """
  def review_overdue?(%Vendor{next_review_at: nil}), do: false

  def review_overdue?(%Vendor{next_review_at: date}) do
    Date.compare(date, Date.utc_today()) == :lt
  end

  # ----- approval transition ---------------------------------------

  @doc """
  Flip the vendor's approval lifecycle. Two regulatory guards on the
  "→ approved" branch (consistent with BRCGS / FSSC 22000 / 21 CFR
  111 audit expectations):

    1. **Checklist completeness** — every artifact in
       `qualification_status/1.missing` must be cleared.
    2. **Segregation of duties** — the actor signing off must NOT be
       the same user who last touched the qualification record
       (`qualified_by_id`). One human can't both collect the evidence
       and sign off on it.

  On the "approved" branch we also stamp an evidence snapshot of
  every certificate currently on file with its `valid_until` so a
  future audit can answer "what was valid the moment you said yes?"
  even if certs are later renewed or deleted.

  De-approval branches (`pending`, `suspended`, `rejected`) clear the
  snapshot + the approver fields.
  """
  def approve_vendor(%User{} = actor, %Vendor{} = vendor, attrs) do
    attrs = stringify_keys(attrs)
    target = attrs["approval_status"]
    vendor = preload_vendor(vendor)

    case target do
      "approved" ->
        with :ok <- enforce_completeness(vendor),
             :ok <- enforce_segregation_of_duties(actor, vendor) do
          do_approve_transition(actor, vendor, attrs, target)
        end

      _ ->
        do_approve_transition(actor, vendor, attrs, target)
    end
  end

  defp enforce_completeness(%Vendor{} = vendor) do
    case qualification_status(vendor) do
      %{complete?: true} -> :ok
      %{missing: missing} -> {:error, {:qualification_incomplete, missing}}
    end
  end

  defp enforce_segregation_of_duties(%User{id: actor_id}, %Vendor{qualified_by_id: qid})
       when not is_nil(qid) and actor_id == qid do
    {:error, :same_signer_as_qualifier}
  end

  defp enforce_segregation_of_duties(_actor, _vendor), do: :ok

  defp do_approve_transition(actor, vendor, attrs, target) do
    before_state = vendor_snapshot(vendor)

    attrs =
      attrs
      |> Map.put("updated_by_id", actor.id)
      |> maybe_stamp_approval(actor, vendor, target)

    vendor
    |> Vendor.approve_changeset(attrs)
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(
          actor,
          "vendor",
          updated,
          before_state,
          vendor_snapshot(updated)
        )

        Backend.Broadcasts.entity_changed(
          "vendor",
          updated.uuid,
          updated.company_id,
          "approval_#{target}"
        )

        {:ok, preload_vendor(updated)}

      other ->
        other
    end
  end

  defp maybe_stamp_approval(attrs, actor, vendor, "approved") do
    attrs
    |> Map.put_new("approved_by_id", actor.id)
    |> Map.put_new("approved_at", DateTime.utc_now() |> DateTime.truncate(:second))
    |> Map.put("approval_evidence_snapshot", build_evidence_snapshot(vendor))
  end

  defp maybe_stamp_approval(attrs, _actor, _vendor, status)
       when status in ["pending", "suspended", "rejected"] do
    attrs
    |> Map.put("approved_by_id", nil)
    |> Map.put("approved_at", nil)
    |> Map.put("approval_evidence_snapshot", nil)
  end

  defp maybe_stamp_approval(attrs, _, _, _), do: attrs

  defp build_evidence_snapshot(%Vendor{} = v) do
    %{
      "approved_at" => DateTime.utc_now() |> DateTime.to_iso8601(),
      "saq_received_at" => v.saq_received_at && Date.to_iso8601(v.saq_received_at),
      "audit_completed_at" =>
        v.audit_completed_at && Date.to_iso8601(v.audit_completed_at),
      "audit_outcome" => v.audit_outcome,
      "vendor_risk" => v.vendor_risk,
      "approved_items_count" => length(v.approved_items),
      "certificates" =>
        Enum.map(v.certificates, fn c ->
          %{
            "certificate_id" => c.certificate_id,
            "certificate_number" => c.certificate_number,
            "valid_until" => c.valid_until && Date.to_iso8601(c.valid_until),
            "document_file_id" => c.document_file_id
          }
        end)
    }
  end

  # ----- approved-item edges ---------------------------------------

  def add_approved_item(%User{} = actor, %Vendor{} = vendor, item_id, attrs \\ %{}) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "vendor_id" => vendor.id,
        "item_id" => item_id,
        "company_id" => vendor.company_id,
        "approved_by_id" => actor.id,
        "approved_at" => now
      })

    %ApprovedItem{}
    |> ApprovedItem.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, row} ->
        Audit.record_created(actor, "vendor_approved_item", row, %{
          vendor_id: row.vendor_id,
          item_id: row.item_id
        })

        Backend.Broadcasts.entity_changed(
          "vendor",
          vendor.uuid,
          vendor.company_id,
          "approved_item_added"
        )

        {:ok, Repo.preload(row, [:item, :approved_by])}

      other ->
        other
    end
  end

  def remove_approved_item(%User{} = actor, %ApprovedItem{} = row) do
    case Repo.delete(row) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "vendor_approved_item", row, %{
          vendor_id: row.vendor_id,
          item_id: row.item_id
        })

        broadcast_vendor_by_id(row.vendor_id, row.company_id, "approved_item_removed")
        {:ok, deleted}

      other ->
        other
    end
  end

  defp broadcast_vendor_by_id(vendor_id, company_id, action)
       when is_integer(vendor_id) and is_integer(company_id) do
    case Repo.get(Vendor, vendor_id) do
      %Vendor{uuid: uuid} ->
        Backend.Broadcasts.entity_changed("vendor", uuid, company_id, action)

      _ ->
        :ok
    end
  end

  defp broadcast_vendor_by_id(_, _, _), do: :ok

  def get_approved_item(vendor_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} -> Repo.get_by(ApprovedItem, vendor_id: vendor_id, uuid: cast)
      :error -> nil
    end
  end

  def get_approved_item(_, _), do: nil

  @doc """
  Edge lookup the PO line validator uses.
  """
  def vendor_can_supply?(vendor_id, item_id)
      when is_integer(vendor_id) and is_integer(item_id) do
    Repo.exists?(
      from(v in Vendor,
        join: ai in ApprovedItem,
        on: ai.vendor_id == v.id and ai.item_id == ^item_id,
        where: v.id == ^vendor_id and v.approval_status == "approved" and v.is_active == true
      )
    )
  end

  # ----- certificate attachments -----------------------------------

  def add_certificate(%User{} = actor, %Vendor{} = vendor, attrs) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "vendor_id" => vendor.id,
        "company_id" => vendor.company_id,
        "uploaded_by_id" => actor.id,
        "uploaded_at" => now
      })

    %VendorCertificate{}
    |> VendorCertificate.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, row} ->
        Audit.record_created(actor, "vendor_certificate", row, %{
          vendor_id: row.vendor_id,
          certificate_id: row.certificate_id,
          valid_until: row.valid_until
        })

        Backend.Broadcasts.entity_changed(
          "vendor",
          vendor.uuid,
          vendor.company_id,
          "certificate_added"
        )

        {:ok, Repo.preload(row, [:certificate, :uploaded_by])}

      other ->
        other
    end
  end

  def update_certificate(%User{} = actor, %VendorCertificate{} = row, attrs) do
    before_state = %{
      certificate_id: row.certificate_id,
      certificate_number: row.certificate_number,
      valid_from: row.valid_from,
      valid_until: row.valid_until
    }

    row
    |> VendorCertificate.changeset(stringify_keys(attrs))
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(
          actor,
          "vendor_certificate",
          updated,
          before_state,
          %{
            certificate_id: updated.certificate_id,
            certificate_number: updated.certificate_number,
            valid_from: updated.valid_from,
            valid_until: updated.valid_until
          }
        )

        broadcast_vendor_by_id(updated.vendor_id, updated.company_id, "certificate_updated")
        {:ok, Repo.preload(updated, [:certificate, :uploaded_by])}

      other ->
        other
    end
  end

  def remove_certificate(%User{} = actor, %VendorCertificate{} = row) do
    case Repo.delete(row) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "vendor_certificate", row, %{
          vendor_id: row.vendor_id,
          certificate_id: row.certificate_id
        })

        broadcast_vendor_by_id(row.vendor_id, row.company_id, "certificate_deleted")
        {:ok, deleted}

      other ->
        other
    end
  end

  def get_certificate(vendor_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.get_by(VendorCertificate, vendor_id: vendor_id, uuid: cast)
        |> Repo.preload([:certificate, :uploaded_by, :document_file])

      :error ->
        nil
    end
  end

  def get_certificate(_, _), do: nil

  # ----- file uploads ----------------------------------------------

  @doc """
  Persist the metadata for an uploaded evidence file. Bytes are
  already on disk via `Backend.Storage`; this just records the row
  + uploader so the file can be served back with provenance.

  The qualification + certificate writes carry an FK to the row this
  creates — that's the bit that wires the file to a specific
  artifact (SAQ / audit / COA / cert).
  """
  def record_file(%User{} = actor, %Vendor{} = vendor, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.put("company_id", vendor.company_id)
      |> Map.put("vendor_id", vendor.id)
      |> Map.put("uploaded_by_id", actor.id)

    %VendorFile{}
    |> VendorFile.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, file} ->
        Backend.Broadcasts.entity_changed(
          "vendor",
          vendor.uuid,
          vendor.company_id,
          "file_added"
        )

        {:ok, Repo.preload(file, :uploaded_by)}

      other ->
        other
    end
  end

  @doc "Look up a file row scoped to the given vendor."
  def get_file(vendor_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from(f in VendorFile,
            where: f.vendor_id == ^vendor_id and f.uuid == ^cast,
            preload: [:uploaded_by]
          )
        )

      :error ->
        nil
    end
  end

  def get_file(_, _), do: nil

  # ----- internals -------------------------------------------------

  defp preload_vendor(%Vendor{} = v) do
    Repo.preload(v, [
      :created_by,
      :updated_by,
      :approved_by,
      :qualified_by,
      :saq_file,
      :audit_file,
      :coa_file,
      approved_items: [:item, :approved_by],
      certificates: [:certificate, :uploaded_by, :document_file]
    ])
  end

  defp vendor_snapshot(%Vendor{} = v),
    do: Map.new(@vendor_audit_fields, fn k -> {k, Map.get(v, k)} end)

  defp stringify_keys(attrs) when is_map(attrs) do
    Map.new(attrs, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end
end
