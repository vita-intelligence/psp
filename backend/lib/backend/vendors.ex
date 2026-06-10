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
  alias Backend.Vendors.{ApprovedItem, Vendor, VendorCertificate}

  @vendor_audit_fields ~w(name legal_name email phone website contact_name legal_address
                          registration_number tax_number tax_rate currency_code
                          default_lead_time_days payment_terms_days payment_basis
                          supply_chain_type vendor_risk product_types
                          questionnaire_status traceability_verification_status
                          review_frequency_months last_review_at next_review_at
                          approval_status approval_notes approved_at notes is_active)a
  @vendor_sortable ~w(id name approval_status vendor_risk next_review_at inserted_at)a
  @vendor_search ~w(name legal_name email contact_name registration_number tax_number notes)a
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
              approved_items: [:item, :approved_by],
              certificates: [:certificate, :uploaded_by]
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
        {:ok, deleted}

      other ->
        other
    end
  end

  # ----- approval transition ---------------------------------------

  @doc """
  Flip the vendor's approval lifecycle. Stamps `approved_by_id` +
  `approved_at` when transitioning to "approved", clears them when
  reverting to a non-approved state.
  """
  def approve_vendor(%User{} = actor, %Vendor{} = vendor, attrs) do
    before_state = vendor_snapshot(vendor)

    attrs =
      attrs
      |> stringify_keys()
      |> Map.put("updated_by_id", actor.id)
      |> maybe_stamp_approval(actor)

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

        {:ok, preload_vendor(updated)}

      other ->
        other
    end
  end

  defp maybe_stamp_approval(%{"approval_status" => "approved"} = attrs, actor) do
    attrs
    |> Map.put_new("approved_by_id", actor.id)
    |> Map.put_new("approved_at", DateTime.utc_now() |> DateTime.truncate(:second))
  end

  defp maybe_stamp_approval(%{"approval_status" => status} = attrs, _actor)
       when status in ["pending", "suspended", "rejected"] do
    attrs
    |> Map.put("approved_by_id", nil)
    |> Map.put("approved_at", nil)
  end

  defp maybe_stamp_approval(attrs, _), do: attrs

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

        {:ok, deleted}

      other ->
        other
    end
  end

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

        {:ok, deleted}

      other ->
        other
    end
  end

  def get_certificate(vendor_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.get_by(VendorCertificate, vendor_id: vendor_id, uuid: cast)
        |> Repo.preload([:certificate, :uploaded_by])

      :error ->
        nil
    end
  end

  def get_certificate(_, _), do: nil

  # ----- internals -------------------------------------------------

  defp preload_vendor(%Vendor{} = v) do
    Repo.preload(v, [
      :created_by,
      :updated_by,
      :approved_by,
      approved_items: [:item, :approved_by],
      certificates: [:certificate, :uploaded_by]
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
