defmodule BackendWeb.Payloads do
  @moduledoc """
  Shared payload shapers — keeps every controller emitting the same
  field set for users and companies so the frontend types are stable.

  Display codes (`PT00007`, `WH00001`, …) are computed here, not
  stored on the row. Each shaper resolves the current company from a
  per-request process cache (`current_company/0`) and hands its
  numbering format to `Backend.Numbering.render/3`.
  """

  alias Backend.{Numbering, RBAC}

  def user(user) do
    %{
      id: user.id,
      uuid: user.uuid,
      code: render_code(user, "user"),
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      is_active: user.is_active,
      is_admin: Map.get(user, :is_admin, false),
      hourly_wage: user.hourly_wage,
      confirmed_at: user.confirmed_at,
      inserted_at: user.inserted_at,
      updated_at: Map.get(user, :updated_at),
      created_by: actor(user, :created_by),
      updated_by: actor(user, :updated_by),
      company_id: user.company_id,
      permissions: RBAC.effective_permissions(user)
    }
  end

  @doc """
  Slim user payload used inside `created_by` / `updated_by` audit
  meta. Just enough to render an avatar + name in the UI — no
  permissions, no wage, no admin flag.
  """
  def audit_actor(%{} = u) do
    %{id: u.id, uuid: u.uuid, name: u.name, email: u.email, avatar: u.avatar}
  end

  def audit_actor(_), do: nil

  defp actor(record, field) do
    case Map.get(record, field) do
      %Ecto.Association.NotLoaded{} -> nil
      nil -> nil
      user -> audit_actor(user)
    end
  end

  def company(company) do
    %{
      id: company.id,
      name: company.name,
      legal_address: company.legal_address,
      email: company.email,
      website: company.website,
      phone: company.phone,
      registration_number: company.registration_number,
      tax_number: company.tax_number,
      tax_rate: company.tax_rate,
      payment_details: company.payment_details,
      timezone: company.timezone,
      date_format: company.date_format,
      first_day_of_week: company.first_day_of_week,
      decimal_separator: company.decimal_separator,
      thousands_separator: company.thousands_separator,
      csv_separator: company.csv_separator,
      currency_code: company.currency_code,
      currency_format: company.currency_format,
      generic_place_name: company.generic_place_name,
      working_hours: company.working_hours,
      holidays: company.holidays,
      currency_rates: company.currency_rates,
      currency_rates_auto_pull: company.currency_rates_auto_pull,
      currency_rates_pulled_at: company.currency_rates_pulled_at,
      currency_rates_source: company.currency_rates_source,
      allowed_ips: company.allowed_ips,
      numbering_formats: company.numbering_formats,
      default_pickup_window_hours: company.default_pickup_window_hours,
      three_pl_rate_per_m3_per_day:
        decimal_to_string(company.three_pl_rate_per_m3_per_day),
      default_three_pl_estimate_days: company.default_three_pl_estimate_days,
      production_yield_tolerance_pct:
        decimal_to_string(company.production_yield_tolerance_pct),
      require_mfa: company.require_mfa,
      inserted_at: company.inserted_at,
      updated_at: company.updated_at
    }
  end

  @doc """
  NPD reverse-integration payload. Token is never returned — the FE
  gets a boolean ``has_token`` so the settings form can show a
  "token is set (retype to change)" hint without decrypting the
  plaintext into the response.
  """
  def npd_integration(company) do
    %{
      enabled: company.npd_integration_enabled,
      base_url: company.npd_base_url,
      frontend_url: company.npd_frontend_url,
      has_token:
        is_binary(company.npd_integration_token) and
          String.trim(company.npd_integration_token) != ""
    }
  end

  @doc """
  Slim org-context payload returned by `GET /api/company/defaults`.
  Any authed user can read this — it carries only the inheritable /
  display fields downstream pages need (timezone the warehouse picker
  shows, locale used to format dates, …). Sensitive identity fields
  (legal address, tax numbers, payment details, IP allow-lists, raw
  numbering formats) stay on the gated `/api/company` payload.
  """
  def company_defaults(company) do
    %{
      id: company.id,
      name: company.name,
      timezone: company.timezone,
      working_hours: company.working_hours,
      holidays: company.holidays,
      date_format: company.date_format,
      first_day_of_week: company.first_day_of_week,
      decimal_separator: company.decimal_separator,
      thousands_separator: company.thousands_separator,
      currency_code: company.currency_code,
      currency_format: company.currency_format,
      generic_place_name: company.generic_place_name,
      default_pickup_window_hours: company.default_pickup_window_hours,
      three_pl_rate_per_m3_per_day:
        decimal_to_string(company.three_pl_rate_per_m3_per_day),
      default_three_pl_estimate_days: company.default_three_pl_estimate_days,
      production_yield_tolerance_pct:
        decimal_to_string(company.production_yield_tolerance_pct)
    }
  end

  def warehouse(w) do
    readiness = Backend.Warehouses.Readiness.check(w.id)

    %{
      id: w.id,
      uuid: w.uuid,
      code: render_code(w, "warehouse"),
      kind: w.kind,
      company_id: w.company_id,
      name: w.name,
      address: w.address,
      notes: w.notes,
      is_active: w.is_active,
      timezone: w.timezone,
      working_hours: w.working_hours,
      holidays: w.holidays,
      contacts: w.contacts,
      plan: w.plan,
      readiness: %{
        ready: readiness.ready?,
        cell_counts_by_purpose: readiness.counts,
        missing_purposes: readiness.blockers
      },
      inserted_at: w.inserted_at,
      updated_at: w.updated_at,
      created_by: actor(w, :created_by),
      updated_by: actor(w, :updated_by)
    }
  end

  @doc """
  Floor payload. `storage_locations` is included when the association
  has been preloaded — otherwise omitted so the FE knows "not loaded"
  rather than "no locations". Empty list means "loaded, but empty".
  """
  def floor(f) do
    base = %{
      id: f.id,
      uuid: f.uuid,
      warehouse_id: f.warehouse_id,
      name: f.name,
      ordinal: f.ordinal,
      canvas_json: f.canvas_json,
      inserted_at: f.inserted_at,
      updated_at: f.updated_at,
      created_by: actor(f, :created_by),
      updated_by: actor(f, :updated_by)
    }

    case Map.get(f, :storage_locations) do
      %Ecto.Association.NotLoaded{} -> base
      nil -> base
      locations -> Map.put(base, :storage_locations, Enum.map(locations, &storage_location/1))
    end
  end

  def storage_location(l) do
    base = %{
      id: l.id,
      uuid: l.uuid,
      warehouse_id: l.warehouse_id,
      floor_id: l.floor_id,
      name: l.name,
      code: l.code,
      x: l.x,
      y: l.y,
      width: l.width,
      height: l.height,
      width_m: l.width_m,
      height_m: l.height_m,
      depth_m: l.depth_m,
      notes: l.notes,
      color: l.color,
      tags: l.tags || [],
      inserted_at: l.inserted_at,
      updated_at: l.updated_at,
      created_by: actor(l, :created_by),
      updated_by: actor(l, :updated_by)
    }

    case Map.get(l, :cells) do
      %Ecto.Association.NotLoaded{} -> Map.put(base, :cells, [])
      nil -> Map.put(base, :cells, [])
      cells -> Map.put(base, :cells, Enum.map(cells, &storage_cell/1))
    end
  end

  @doc """
  One row from the company-scoped tag registry. The picker on the
  warehouse plan editor reads from this; allocation matches against
  `key` (the lowercased canonical identifier).
  """
  def storage_tag(t) do
    %{
      id: t.id,
      uuid: t.uuid,
      code: render_code(t, "storage_tag"),
      key: t.key,
      label: t.label,
      description: t.description,
      kind: t.kind,
      inserted_at: t.inserted_at,
      updated_at: t.updated_at,
      created_by: actor(t, :created_by),
      updated_by: actor(t, :updated_by)
    }
  end

  # Returns the live blocker list on the show endpoint (where
  # per-type subtables are preloaded), or ``nil`` on list endpoints
  # where the row's ``compliance_status`` column is authoritative and
  # we can't afford a preload per row.
  #
  # Preloaded-nil vs NotLoaded is the key signal: after ``Repo.preload``
  # a missing side-table row surfaces as ``nil`` (not ``%NotLoaded{}``),
  # and that's a legitimate answer we want the check to reason about —
  # ``Compliance.check`` emits a top-level "subtable hasn't been filled
  # in" blocker for it, which is exactly what the banner should show.
  # The old ``match?`` guard against the specific struct name treated
  # ``nil`` as "not loaded" and short-circuited the check to ``nil``,
  # so items imported without a compliance side-table row showed the
  # amber "ready to promote" banner even though the promote path would
  # (correctly) refuse them at ``mark_ready/2`` time.
  defp compliance_blockers(%Backend.Items.Item{} = i) do
    subtables_preloaded? =
      not match?(%Ecto.Association.NotLoaded{}, i.raw_material_compliance) and
        not match?(%Ecto.Association.NotLoaded{}, i.raw_material_risk) and
        not match?(%Ecto.Association.NotLoaded{}, i.finished_product_spec) and
        not match?(%Ecto.Association.NotLoaded{}, i.packaging_compliance)

    if subtables_preloaded? do
      case Backend.Items.Compliance.check(i) do
        {:ok, []} -> []
        {:missing, list} -> list
      end
    else
      nil
    end
  end

  @doc """
  Item — name + type + identity + audit. Per-type compliance subtable
  data (raw-material, finished-product, packaging) is preloaded
  separately by the controller; this shaper covers the core row only.
  """
  def item(i) do
    base = %{
      id: i.id,
      uuid: i.uuid,
      code: render_code(i, "item"),
      name: i.name,
      description: i.description,
      item_type: i.item_type,
      external_sku: i.external_sku,
      barcode: i.barcode,
      stock_uom: maybe_unit_compact(i.stock_uom),
      stock_uom_id: i.stock_uom_id,
      product_family: maybe_family_compact(i.product_family),
      product_family_id: i.product_family_id,
      attributes: i.attributes || %{},
      storage_tags: i.storage_tags || [],
      is_active: i.is_active,
      compliance_status: i.compliance_status,
      compliance_readied_at: i.compliance_readied_at,
      compliance_readied_by: actor(i, :compliance_readied_by),
      compliance_revert_reason: i.compliance_revert_reason,
      compliance_blockers: compliance_blockers(i),
      # Reorder-point pair. Both nil means the item isn't participating
      # in the reorder game; the FE renders no ROP UI in that case.
      min_stock_qty: i.min_stock_qty,
      target_stock_qty: i.target_stock_qty,
      inserted_at: i.inserted_at,
      updated_at: i.updated_at,
      created_by: actor(i, :created_by),
      updated_by: actor(i, :updated_by)
    }

    # Sub-tables are only included when preloaded — list endpoints
    # never load them (saves a join per row), show endpoints do.
    # ``raw_material_compliance`` is special: when the item is a raw
    # material and the subtable is preloaded but nil (row doesn't
    # exist yet — common for items imported from the NPD integration
    # wire), we still emit a payload keyed to ``item.attributes``
    # fallbacks so the form's "Used as" dropdown shows whatever the
    # jsonb bag carries. Without this the form reads blank and the
    # operator has to re-pick something the system already knows.
    base
    |> add_raw_material_compliance(i)
    |> add_optional(:raw_material_risk, i.raw_material_risk, &raw_material_risk/1)
    |> add_optional(:finished_product_spec, i.finished_product_spec,
      &finished_product_spec(&1, i))
    |> add_optional(:packaging_compliance, i.packaging_compliance,
      &packaging_compliance(&1, i))
    |> add_optional(:certificate_attachments, i.certificate_attachments, fn list ->
      Enum.map(list, &item_certificate/1)
    end)
    |> add_optional(:images, i.images, fn list -> Enum.map(list, &item_image/1) end)
    |> add_optional(:files, i.files, fn list -> Enum.map(list, &item_file(&1, i)) end)
    |> add_optional(:allergens, i.allergens, fn list -> Enum.map(list, &allergen/1) end)
  end

  def certificate(c) do
    %{
      id: c.id,
      uuid: c.uuid,
      code: render_code(c, "certificate"),
      name: c.name,
      certificate_type: c.certificate_type,
      issuing_body: c.issuing_body,
      default_validity_months: c.default_validity_months,
      description: c.description,
      is_active: c.is_active,
      inserted_at: c.inserted_at,
      updated_at: c.updated_at,
      created_by: actor(c, :created_by),
      updated_by: actor(c, :updated_by)
    }
  end

  @doc """
  Per-item image. `url` is rendered through the storage adapter — for
  the local adapter it's an authed Phoenix route; for cloud adapters
  it'll be a short-lived signed URL.
  """
  def item_image(i) do
    %{
      uuid: i.uuid,
      item_id: i.item_id,
      url: Backend.Storage.public_url(i.blob_path),
      caption: i.caption,
      is_primary: i.is_primary,
      sort_order: i.sort_order,
      original_filename: i.original_filename,
      content_type: i.content_type,
      byte_size: i.byte_size,
      uploaded_at: i.uploaded_at,
      uploaded_by: actor(i, :uploaded_by)
    }
  end

  def item_certificate(a) do
    %{
      uuid: a.uuid,
      item_id: a.item_id,
      certificate_id: a.certificate_id,
      certificate: maybe_certificate_compact(a.certificate),
      certificate_number: a.certificate_number,
      valid_from: a.valid_from,
      valid_until: a.valid_until,
      document_url: a.document_url,
      notes: a.notes,
      uploaded_at: a.uploaded_at,
      uploaded_by: actor(a, :uploaded_by)
    }
  end

  @doc """
  Full vendor — registry list + detail page. Includes preloaded
  approved-items and certificate edges so the FE detail page renders
  in one round-trip.
  """
  def vendor(v) do
    %{
      id: v.id,
      uuid: v.uuid,
      code: render_code(v, "vendor"),
      name: v.name,
      legal_name: v.legal_name,
      email: v.email,
      phone: v.phone,
      website: v.website,
      contact_name: v.contact_name,
      legal_address: v.legal_address,
      registration_number: v.registration_number,
      tax_number: v.tax_number,
      tax_rate: v.tax_rate,
      currency_code: v.currency_code,
      default_lead_time_days: v.default_lead_time_days,
      payment_terms_days: v.payment_terms_days,
      payment_basis: v.payment_basis,
      supply_chain_type: v.supply_chain_type,
      vendor_risk: v.vendor_risk,
      product_types: v.product_types || [],
      questionnaire_status: v.questionnaire_status,
      traceability_verification_status: v.traceability_verification_status,
      review_frequency_months: v.review_frequency_months,
      last_review_at: v.last_review_at,
      next_review_at: v.next_review_at,
      approval_status: v.approval_status,
      approval_notes: v.approval_notes,
      approved_at: v.approved_at,
      approved_by: actor(v, :approved_by),
      approval_evidence_snapshot: v.approval_evidence_snapshot,
      # Qualification artifacts (BRCGS / FSSC 22000 / GFSI / 21 CFR
      # 111 audit checklist). `qualification` is computed — the
      # FE renders it as a "what's blocking approval" panel.
      saq_received_at: v.saq_received_at,
      saq_file: maybe_vendor_file(v.saq_file, v),
      risk_assessment_completed_at: v.risk_assessment_completed_at,
      risk_assessment_notes: v.risk_assessment_notes,
      audit_required: v.audit_required,
      audit_completed_at: v.audit_completed_at,
      audit_kind: v.audit_kind,
      audit_outcome: v.audit_outcome,
      audit_file: maybe_vendor_file(v.audit_file, v),
      audit_notes: v.audit_notes,
      coa_received_at: v.coa_received_at,
      coa_file: maybe_vendor_file(v.coa_file, v),
      qualified_at: v.qualified_at,
      qualified_by: actor(v, :qualified_by),
      qualification: Backend.Vendors.qualification_status(v),
      review_overdue: Backend.Vendors.review_overdue?(v),
      notes: v.notes,
      is_active: v.is_active,
      approved_items: preloaded_list(v, :approved_items, &vendor_approved_item/1),
      certificates: preloaded_list(v, :certificates, &vendor_certificate/1),
      inserted_at: v.inserted_at,
      updated_at: v.updated_at,
      created_by: actor(v, :created_by),
      updated_by: actor(v, :updated_by)
    }
  end

  @doc """
  Picker-shaped summary — id/uuid/name/code + the bits PO forms need
  to surface the right vendor to the right line: currency, lead
  time, approval status (greyed-out tile when not approved).
  """
  def vendor_summary(v) do
    %{
      id: v.id,
      uuid: v.uuid,
      code: render_code(v, "vendor"),
      name: v.name,
      # Email surfaces on PO detail so the FE can gate the Send PO /
      # Send RFQ / Send note buttons on the presence of a primary
      # contact email without a second round-trip.
      email: v.email,
      currency_code: v.currency_code,
      default_lead_time_days: v.default_lead_time_days,
      # Surfaced so the FE quick-add-invoice flow can default the
      # invoice due date to `today + payment_terms_days` without a
      # second vendor fetch.
      payment_terms_days: v.payment_terms_days,
      # Vendor default tax rate — surfaced so the new-PO form can
      # pre-fill the totals preview after a vendor pick without a
      # second round-trip to /api/vendors/:uuid.
      tax_rate: v.tax_rate,
      approval_status: v.approval_status,
      is_active: v.is_active
    }
  end

  @doc """
  Edge of vendor↔item approved-supplier graph. PO line validation
  uses the matching presence of one of these rows.
  """
  def vendor_approved_item(row) do
    %{
      uuid: row.uuid,
      vendor_id: row.vendor_id,
      item_id: row.item_id,
      item: maybe_item_summary(row.item),
      approved_at: row.approved_at,
      approved_by: actor(row, :approved_by),
      notes: row.notes
    }
  end

  @doc """
  Per-vendor certificate attachment. Shape mirrors `item_certificate/1`
  so the FE can reuse the validity-window UI between item certs and
  vendor certs.
  """
  def vendor_certificate(row) do
    %{
      uuid: row.uuid,
      vendor_id: row.vendor_id,
      certificate_id: row.certificate_id,
      certificate: maybe_certificate_compact(row.certificate),
      certificate_number: row.certificate_number,
      valid_from: row.valid_from,
      valid_until: row.valid_until,
      document_file: maybe_vendor_file(row.document_file, row),
      notes: row.notes,
      uploaded_at: row.uploaded_at,
      uploaded_by: actor(row, :uploaded_by)
    }
  end

  @doc """
  Public payload for a stored evidence file. Includes the serve URL
  the FE can fetch the bytes from. `vendor` is the parent so the URL
  can be scoped — files only resolve under their owning vendor.
  """
  def vendor_file(%Backend.Vendors.VendorFile{} = f, vendor) do
    vendor_uuid = vendor && Map.get(vendor, :uuid)

    %{
      # `id` is emitted because the qualification + cert PUTs accept
      # `*_file_id` (integer FK). Within the same tenant this is fine.
      id: f.id,
      uuid: f.uuid,
      kind: f.kind,
      filename: f.filename,
      mime: f.mime,
      byte_size: f.byte_size,
      url:
        vendor_uuid &&
          "/api/vendors/" <>
            vendor_uuid <> "/files/" <> f.uuid <> "/serve",
      uploaded_at: f.inserted_at,
      uploaded_by: actor(f, :uploaded_by)
    }
  end

  defp maybe_vendor_file(%Backend.Vendors.VendorFile{} = f, parent),
    do: vendor_file(f, parent)

  defp maybe_vendor_file(_, _), do: nil

  # ---------------------------------------------------------------
  # Customers (sell-side).
  # ---------------------------------------------------------------

  @doc """
  Full customer payload — list rows + detail page. Preloads contacts
  / files / contact_events so the FE detail page renders in one
  round-trip.

  `status` is the read-time projection of the customer's lifecycle
  (lead / prospect / active / dormant / inactive) computed from
  contact events + order rollups — never written to a column.
  """
  def customer(c) do
    %{
      id: c.id,
      uuid: c.uuid,
      code: render_code(c, "customer"),
      name: c.name,
      legal_name: c.legal_name,
      contact_name: c.contact_name,
      website: c.website,
      legal_address: c.legal_address,
      country_code: c.country_code,
      registration_number: c.registration_number,
      tax_number: c.tax_number,
      currency_code: c.currency_code,
      tax_rate: c.tax_rate,
      default_discount_percent: c.default_discount_percent,
      language_code: c.language_code,
      payment_terms_days: c.payment_terms_days,
      payment_terms_basis: c.payment_terms_basis,
      trade_credit_limit: c.trade_credit_limit,
      pricelist_id: c.pricelist_id,
      contact_frequency_months: c.contact_frequency_months,
      contact_started_at: c.contact_started_at,
      last_contact_at: c.last_contact_at,
      next_contact_at: c.next_contact_at,
      first_order_at: c.first_order_at,
      last_order_at: c.last_order_at,
      total_orders_count: c.total_orders_count,
      approval_status: c.approval_status,
      approval_notes: c.approval_notes,
      approved_at: c.approved_at,
      approved_by: actor(c, :approved_by),
      approval_evidence_snapshot: c.approval_evidence_snapshot,
      # Effective approval state — folds in re-qualification cadence +
      # is_active flag so the UI badge tells the truth even when the
      # stored `approval_status` is stale (e.g. approved 13 months ago,
      # never re-qualified ⇒ effectively suspended).
      effective_approval_status:
        elem(Backend.Customers.effective_approval_status(c), 0),
      effective_approval_reason:
        elem(Backend.Customers.effective_approval_status(c), 1)
        |> Atom.to_string(),
      is_active: c.is_active,
      account_manager: actor(c, :account_manager),
      # Derived status — computed from event history; never stored.
      status: Backend.Customers.status_projection(c) |> Atom.to_string(),
      # Qualification (KYC / Credit / AML / Contract) — each section
      # carries the timestamp + actor + (where present) outcome + file.
      kyc_verified_at: c.kyc_verified_at,
      kyc_verified_by: actor(c, :kyc_verified_by),
      kyc_file: maybe_customer_file(c.kyc_file, c),
      kyc_notes: c.kyc_notes,
      credit_check_at: c.credit_check_at,
      credit_check_by: actor(c, :credit_check_by),
      credit_check_outcome: c.credit_check_outcome,
      credit_check_score: c.credit_check_score,
      credit_check_file: maybe_customer_file(c.credit_check_file, c),
      credit_check_notes: c.credit_check_notes,
      aml_screened_at: c.aml_screened_at,
      aml_screened_by: actor(c, :aml_screened_by),
      aml_outcome: c.aml_outcome,
      aml_notes: c.aml_notes,
      contract_signed_at: c.contract_signed_at,
      contract_signed_by: actor(c, :contract_signed_by),
      contract_file: maybe_customer_file(c.contract_file, c),
      contract_notes: c.contract_notes,
      qualified_at: c.qualified_at,
      qualified_by: actor(c, :qualified_by),
      qualification: Backend.Customers.qualification_status(c),
      review_frequency_months: c.review_frequency_months,
      last_review_at: c.last_review_at,
      next_review_at: c.next_review_at,
      review_overdue: Backend.Customers.review_overdue?(c),
      contacts: preloaded_list(c, :contacts, &customer_contact/1),
      files: preloaded_list(c, :files, fn f -> customer_file(f, c) end),
      contact_events:
        preloaded_list(c, :contact_events, &customer_contact_event/1),
      approved_items:
        preloaded_list(c, :approved_items, &customer_approved_item/1),
      inserted_at: c.inserted_at,
      updated_at: c.updated_at,
      created_by: actor(c, :created_by),
      updated_by: actor(c, :updated_by)
    }
  end

  defp maybe_customer_file(%Backend.Customers.CustomerFile{} = f, parent),
    do: customer_file(f, parent)

  defp maybe_customer_file(_, _), do: nil

  # ---------------------------------------------------------------
  # Pricelists.
  # ---------------------------------------------------------------

  @doc """
  Full pricelist payload — list rows + detail page. Preloads line
  items (with their item summary + stock UoM) so the FE detail page
  renders in one round-trip.
  """
  def pricelist(p) do
    %{
      id: p.id,
      uuid: p.uuid,
      code: render_code(p, "pricelist"),
      name: p.name,
      currency_code: p.currency_code,
      is_default: p.is_default,
      is_active: p.is_active,
      valid_from: p.valid_from,
      valid_until: p.valid_until,
      notes: p.notes,
      items: preloaded_list(p, :items, &pricelist_item/1),
      inserted_at: p.inserted_at,
      updated_at: p.updated_at,
      created_by: actor(p, :created_by),
      updated_by: actor(p, :updated_by)
    }
  end

  @doc """
  Picker-shaped pricelist — id/uuid/name/code + the bits a customer
  form / future CO form needs to surface the right pricelist to the
  right line.
  """
  def pricelist_summary(p) do
    %{
      id: p.id,
      uuid: p.uuid,
      code: render_code(p, "pricelist"),
      name: p.name,
      currency_code: p.currency_code,
      is_default: p.is_default,
      is_active: p.is_active
    }
  end

  @doc """
  One pricelist line — the (pricelist × item × min_qty) tier row.
  """
  def pricelist_item(row) do
    %{
      uuid: row.uuid,
      pricelist_id: row.pricelist_id,
      item_id: row.item_id,
      item: maybe_item_summary(row.item),
      selling_price: row.selling_price,
      min_quantity: row.min_quantity,
      notes: row.notes,
      inserted_at: row.inserted_at,
      updated_at: row.updated_at
    }
  end

  # ---------------------------------------------------------------
  # Customer orders.
  # ---------------------------------------------------------------

  @doc """
  Full customer-order payload — list rows + detail page. Preloads
  customer + lines + approvals + files + actor stamps so the FE
  detail page renders in one round-trip.
  """
  def customer_order(co) do
    %{
      id: co.id,
      uuid: co.uuid,
      code: render_code(co, "customer_order"),
      status: co.status,
      customer: maybe_customer_compact(co.customer),
      customer_id: co.customer_id,
      currency_code: co.currency_code,
      subtotal: co.subtotal,
      discount_pct: co.discount_pct,
      discount_amount: co.discount_amount,
      tax_rate: co.tax_rate,
      tax_amount: co.tax_amount,
      shipping_fees: co.shipping_fees,
      additional_fees: co.additional_fees,
      grand_total: co.grand_total,
      expected_ship_date: co.expected_ship_date,
      due_date: co.due_date,
      delivery_address: co.delivery_address,
      customer_reference: co.customer_reference,
      notes: co.notes,
      # Flags this CO as a sample-fulfilment (NPD sample workflow)
      # rather than a commercial order. /projects renders a chip on
      # the row and other surfaces can use it to hide samples from
      # invoicing / dispatch reports.
      sample_kind: co.sample_kind,
      # NPD payment mirror — sample COs have their payment record
      # populated at sync time. The CO detail invoice card renders
      # this instead of the "Generate invoice" prompt because the
      # customer already paid on NPD and no PSP-side invoice is
      # needed. Files list is metadata only (bytes stay on NPD).
      npd_payment_id: co.npd_payment_id,
      npd_payment_amount: co.npd_payment_amount,
      npd_payment_currency: co.npd_payment_currency,
      npd_payment_invoice_number: co.npd_payment_invoice_number,
      npd_payment_paid_at: co.npd_payment_paid_at,
      npd_payment_status: co.npd_payment_status,
      npd_payment_files: co.npd_payment_files || [],
      npd_formulation_uuid: co.npd_formulation_uuid,
      npd_lead_scientist_name: co.npd_lead_scientist_name,
      npd_sales_person_name: co.npd_sales_person_name,
      npd_app_url: co.npd_app_url,
      npd_customer_uuid: co.npd_customer_uuid,
      npd_customer_display_name: co.npd_customer_display_name,
      npd_cff_uuid: co.npd_cff_uuid,
      npd_cff_url: co.npd_cff_url,
      npd_cff_submitter_name: co.npd_cff_submitter_name,
      npd_cff_submitter_email: co.npd_cff_submitter_email,
      npd_spec_sheet_uuid: co.npd_spec_sheet_uuid,
      npd_spec_sheet_url: co.npd_spec_sheet_url,
      npd_spec_prepared_by_name: co.npd_spec_prepared_by_name,
      npd_spec_prepared_at: co.npd_spec_prepared_at,
      npd_spec_director_name: co.npd_spec_director_name,
      npd_spec_approved_at: co.npd_spec_approved_at,
      npd_spec_customer_signed_at: co.npd_spec_customer_signed_at,
      npd_spec_customer_signed_by_name: co.npd_spec_customer_signed_by_name,
      bundled_specs: bundled_specs(co),
      npd_proposal_uuid: co.npd_proposal_uuid,
      npd_proposal_code: co.npd_proposal_code,
      npd_proposal_url: co.npd_proposal_url,
      npd_proposal_status: co.npd_proposal_status,
      npd_proposal_accepted_at: co.npd_proposal_accepted_at,
      npd_proposal_accepted_by_name: co.npd_proposal_accepted_by_name,
      # Trial-batch cycle mirror — non-nil only when this CO is a
      # sample-slot child of a custom-formulation cycle. Drives the
      # "↳ Trial N/M · <ref>" badge on the /projects kanban.
      parent_customer_order_uuid: co.parent_customer_order_uuid,
      parent_customer_order_reference: co.parent_customer_order_reference,
      npd_trial_slot_sequence_no: co.npd_trial_slot_sequence_no,
      npd_trial_slot_total: co.npd_trial_slot_total,
      # Bundled deposit+samples Payment approval timestamp. Drives
      # the wizard's :trial_batches_in_flight phase.
      npd_deposit_paid_at: co.npd_deposit_paid_at,
      # Label-design workflow mirror. Populated by vita-cff's
      # LabelDesign post_save signal via the proposal-merge sync.
      # All nil when no label workflow exists yet for the primary
      # formulation.
      npd_label_design_uuid: co.npd_label_design_uuid,
      npd_label_status: co.npd_label_status,
      npd_label_design_path: co.npd_label_design_path,
      npd_label_approved_at: co.npd_label_approved_at,
      npd_label_rejection_count: co.npd_label_rejection_count,
      npd_label_updated_at: co.npd_label_updated_at,
      npd_label_preview_png_url: co.npd_label_preview_png_url,
      npd_label_pdf_url: co.npd_label_pdf_url,
      npd_label_url: co.npd_label_url,
      # Supplementary artwork views on the current LabelDesign
      # revision (back / side / bottle mockup). PSP opens each through
      # the file proxy so the customer's browser can render bytes
      # that live on NPD.
      npd_label_files: co.npd_label_files || [],
      # One URL for the dashboard tile + detail hero header image
      # (NPD picked: approved label preview → first product photo →
      # empty).
      npd_header_image_url: co.npd_header_image_url,
      # Multi-payment mirror — deposit / additional_samples /
      # label_design / final each as a discrete row. Empty on projects
      # with no finance activity yet.
      npd_payments: preloaded_list(co, :npd_payments, &npd_payment_row/1),
      default_warehouse_id: co.default_warehouse_id,
      default_warehouse: maybe_warehouse_compact(co.default_warehouse),
      submitted_at: co.submitted_at,
      submitted_by: actor(co, :submitted_by),
      confirmed_at: co.confirmed_at,
      confirmed_by: actor(co, :confirmed_by),
      cancelled_at: co.cancelled_at,
      cancelled_by: actor(co, :cancelled_by),
      cancellation_reason: co.cancellation_reason,
      lines: preloaded_list(co, :lines, &customer_order_line/1),
      approvals: preloaded_list(co, :approvals, &customer_order_approval/1),
      files: preloaded_list(co, :files, fn f -> customer_order_file(f, co) end),
      inserted_at: co.inserted_at,
      updated_at: co.updated_at,
      created_by: actor(co, :created_by),
      updated_by: actor(co, :updated_by)
    }
  end

  defp maybe_customer_compact(%Backend.Customers.Customer{} = c) do
    %{
      id: c.id,
      uuid: c.uuid,
      code: render_code(c, "customer"),
      name: c.name,
      currency_code: c.currency_code,
      payment_terms_days: c.payment_terms_days,
      payment_terms_basis: c.payment_terms_basis,
      trade_credit_limit: c.trade_credit_limit,
      approval_status: c.approval_status,
      effective_approval_status:
        elem(Backend.Customers.effective_approval_status(c), 0)
    }
  end

  defp maybe_customer_compact(_), do: nil

  defp maybe_warehouse_compact(%Backend.Warehouses.Warehouse{} = w) do
    %{id: w.id, uuid: w.uuid, name: w.name}
  end

  defp maybe_warehouse_compact(_), do: nil

  # One row in the CO's ``npd_payments`` list. Passed straight through
  # to the client — the shape mirrors the vita-cff sync payload
  # (kind / amount / currency / status / invoice_number / paid_at /
  # files) so the invoice card can render without a translation
  # layer.
  defp npd_payment_row(%Backend.CustomerOrders.NpdPayment{} = p) do
    %{
      npd_payment_id: p.npd_payment_id,
      kind: p.kind,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      invoice_number: p.invoice_number,
      paid_at: p.paid_at,
      files: p.files || [],
      synced_at: p.synced_at
    }
  end

  # Every spec sheet referenced by this CO or by any of its merged
  # secondaries. A bundled proposal spans N formulations, but the
  # primary CO only stores ONE ``npd_spec_sheet_uuid`` on its own
  # row — the sibling specs live on the secondary COs. This helper
  # flattens the manifest so the FE can render one "Open spec on
  # NPD" link per formulation.
  #
  # Ordering: primary first (matches "first picked" in the merge
  # semantics), then secondaries in insertion order. Entries with
  # no ``npd_spec_sheet_uuid`` are dropped so the list never
  # renders a broken link.
  defp bundled_specs(%Backend.CustomerOrders.CustomerOrder{} = co) do
    secondaries =
      case co.merged_secondaries do
        list when is_list(list) -> list
        _ -> []
      end

    ([co] ++ secondaries)
    |> Enum.map(&spec_entry/1)
    |> Enum.reject(&is_nil/1)
  end

  defp spec_entry(%Backend.CustomerOrders.CustomerOrder{} = row) do
    if row.npd_spec_sheet_uuid do
      %{
        formulation_uuid: row.npd_formulation_uuid,
        # ``customer_reference`` is where the NPD sync plants the
        # human label ("Immunity Complex Gummies (MA01421)") — reuse
        # it so we don't have to make another round trip for a name.
        formulation_label: row.customer_reference,
        spec_sheet_uuid: row.npd_spec_sheet_uuid,
        spec_sheet_url: row.npd_spec_sheet_url,
        prepared_by_name: row.npd_spec_prepared_by_name,
        prepared_at: row.npd_spec_prepared_at,
        director_name: row.npd_spec_director_name,
        approved_at: row.npd_spec_approved_at
      }
    end
  end

  @doc """
  One CO line — item + quoted price + tier (line_subtotal already
  carries discount applied).
  """
  def customer_order_line(line) do
    %{
      uuid: line.uuid,
      customer_order_id: line.customer_order_id,
      item_id: line.item_id,
      item: maybe_item_summary(line.item),
      qty_ordered: line.qty_ordered,
      unit_price: line.unit_price,
      discount_pct: line.discount_pct,
      line_subtotal: line.line_subtotal,
      expected_ship_date: line.expected_ship_date,
      customer_part_no: line.customer_part_no,
      notes: line.notes,
      warehouse_id: line.warehouse_id,
      warehouse: maybe_warehouse_compact(line.warehouse),
      pricelist_id: line.pricelist_id,
      pricelist:
        case Map.get(line, :pricelist) do
          %Backend.Pricelists.Pricelist{} = p ->
            %{id: p.id, uuid: p.uuid, name: p.name, currency_code: p.currency_code}

          _ ->
            nil
        end,
      short_delivery_accepted_at: line.short_delivery_accepted_at,
      short_delivery_accepted_reason: line.short_delivery_accepted_reason,
      short_delivery_accepted_by:
        case Map.get(line, :short_delivery_accepted_by) do
          %Backend.Accounts.User{} = u -> %{id: u.id, name: u.name, email: u.email}
          _ -> nil
        end,
      inserted_at: line.inserted_at,
      updated_at: line.updated_at
    }
  end

  @doc """
  One ESIGN signature on a CO. Same shape as PO approvals.
  """
  def customer_order_approval(row) do
    %{
      uuid: row.uuid,
      customer_order_id: row.customer_order_id,
      kind: row.kind,
      signed_at: row.signed_at,
      notes: row.notes,
      signed_by: actor(row, :signed_by),
      inserted_at: row.inserted_at
    }
  end

  @doc """
  CO file metadata + serve URL.
  """
  def customer_order_file(%Backend.CustomerOrders.CustomerOrderFile{} = f, co) do
    co_uuid = co && Map.get(co, :uuid)

    %{
      id: f.id,
      uuid: f.uuid,
      kind: f.kind,
      filename: f.filename,
      mime: f.mime,
      byte_size: f.byte_size,
      url:
        co_uuid &&
          "/api/customer-orders/" <>
            co_uuid <> "/files/" <> f.uuid <> "/serve",
      uploaded_at: f.inserted_at,
      uploaded_by: actor(f, :uploaded_by)
    }
  end

  @doc """
  Pricelist suggestion shape for the CO line auto-price endpoint.
  """
  def customer_order_price_suggestion(nil), do: nil

  def customer_order_price_suggestion(%{
        unit_price: unit_price,
        currency_code: currency_code,
        min_quantity: min_quantity,
        pricelist_id: pricelist_id,
        pricelist_uuid: pricelist_uuid,
        pricelist_name: pricelist_name,
        source: source
      }) do
    %{
      unit_price: unit_price,
      currency_code: currency_code,
      min_quantity: min_quantity,
      pricelist_id: pricelist_id,
      pricelist_uuid: pricelist_uuid,
      pricelist_name: pricelist_name,
      source: Atom.to_string(source)
    }
  end

  @doc """
  Per-customer approved-item row payload.
  """
  def customer_approved_item(row) do
    %{
      uuid: row.uuid,
      customer_id: row.customer_id,
      item_id: row.item_id,
      item: maybe_item_summary(row.item),
      approved_at: row.approved_at,
      approved_by: actor(row, :approved_by),
      notes: row.notes
    }
  end

  # ---------------------------------------------------------------
  # Customer invoices.
  # ---------------------------------------------------------------

  @doc """
  Full customer-invoice payload with lines + payments + outstanding
  computed from the live payment set. The FE workflow card reads
  `outstanding` directly so it doesn't have to re-sum payments per
  render.
  """
  def customer_invoice(inv) do
    outstanding = Backend.CustomerInvoices.outstanding_for_invoice(inv)
    paid_amount =
      Enum.reduce(inv.payments || [], Decimal.new(0), fn p, acc ->
        Decimal.add(acc, p.amount || Decimal.new(0))
      end)

    %{
      id: inv.id,
      uuid: inv.uuid,
      code: render_code(inv, "customer_invoice"),
      kind: inv.kind,
      status: inv.status,
      customer: maybe_customer_compact(inv.customer),
      customer_id: inv.customer_id,
      customer_order:
        case inv.customer_order do
          %Backend.CustomerOrders.CustomerOrder{} = co ->
            %{
              id: co.id,
              uuid: co.uuid,
              code: render_code(co, "customer_order"),
              status: co.status,
              grand_total: co.grand_total
            }

          _ ->
            nil
        end,
      customer_order_id: inv.customer_order_id,
      currency_code: inv.currency_code,
      subtotal: inv.subtotal,
      discount_pct: inv.discount_pct,
      discount_amount: inv.discount_amount,
      tax_rate: inv.tax_rate,
      tax_amount: inv.tax_amount,
      grand_total: inv.grand_total,
      paid_amount: paid_amount,
      outstanding: outstanding,
      invoice_date: inv.invoice_date,
      due_date: inv.due_date,
      billing_address: inv.billing_address,
      customer_reference: inv.customer_reference,
      free_text: inv.free_text,
      sent_at: inv.sent_at,
      sent_by: actor(inv, :sent_by),
      cancelled_at: inv.cancelled_at,
      cancelled_by: actor(inv, :cancelled_by),
      cancellation_reason: inv.cancellation_reason,
      lines: preloaded_list(inv, :lines, &customer_invoice_line/1),
      payments: preloaded_list(inv, :payments, &customer_invoice_payment/1),
      inserted_at: inv.inserted_at,
      updated_at: inv.updated_at,
      created_by: actor(inv, :created_by),
      updated_by: actor(inv, :updated_by)
    }
  end

  @doc """
  One invoice line, including the CO line link so the FE can render
  "from CO00080" hyperlinks back to the source order.
  """
  def customer_invoice_line(line) do
    %{
      uuid: line.uuid,
      customer_invoice_id: line.customer_invoice_id,
      item_id: line.item_id,
      item: maybe_item_summary(line.item),
      customer_order_line_id: line.customer_order_line_id,
      description: line.description,
      qty: line.qty,
      unit_price: line.unit_price,
      discount_pct: line.discount_pct,
      line_subtotal: line.line_subtotal,
      delivery_date: line.delivery_date,
      notes: line.notes,
      inserted_at: line.inserted_at,
      updated_at: line.updated_at
    }
  end

  @doc """
  One payment row.
  """
  def customer_invoice_payment(payment) do
    %{
      uuid: payment.uuid,
      customer_invoice_id: payment.customer_invoice_id,
      paid_at: payment.paid_at,
      amount: payment.amount,
      method: payment.method,
      reference: payment.reference,
      notes: payment.notes,
      recorded_by: actor(payment, :recorded_by),
      inserted_at: payment.inserted_at
    }
  end

  # ---------------------------------------------------------------
  # Customer returns (RMAs).
  # ---------------------------------------------------------------

  @doc """
  Full customer-return payload with lines + files + actor stamps.
  """
  def customer_return(rma) do
    %{
      id: rma.id,
      uuid: rma.uuid,
      code: render_code(rma, "customer_return"),
      status: rma.status,
      customer: maybe_customer_compact(rma.customer),
      customer_id: rma.customer_id,
      customer_invoice:
        case rma.customer_invoice do
          %Backend.CustomerInvoices.CustomerInvoice{} = inv ->
            %{
              id: inv.id,
              uuid: inv.uuid,
              code: render_code(inv, "customer_invoice"),
              status: inv.status,
              grand_total: inv.grand_total,
              currency_code: inv.currency_code
            }

          _ ->
            nil
        end,
      customer_invoice_id: rma.customer_invoice_id,
      return_date: rma.return_date,
      reason_summary: rma.reason_summary,
      notes: rma.notes,
      received_at: rma.received_at,
      received_by: actor(rma, :received_by),
      resolved_at: rma.resolved_at,
      resolved_by: actor(rma, :resolved_by),
      cancelled_at: rma.cancelled_at,
      cancelled_by: actor(rma, :cancelled_by),
      cancellation_reason: rma.cancellation_reason,
      rejection_reason: rma.rejection_reason,
      lines: preloaded_list(rma, :lines, &customer_return_line/1),
      files: preloaded_list(rma, :files, fn f -> customer_return_file(f, rma) end),
      inserted_at: rma.inserted_at,
      updated_at: rma.updated_at,
      created_by: actor(rma, :created_by),
      updated_by: actor(rma, :updated_by)
    }
  end

  @doc """
  One RMA line — item + qty_returned + qty_accepted (set at
  inspection) + reason + line_credit_amount.
  """
  def customer_return_line(line) do
    %{
      uuid: line.uuid,
      customer_return_id: line.customer_return_id,
      item_id: line.item_id,
      item: maybe_item_summary(line.item),
      customer_invoice_line_id: line.customer_invoice_line_id,
      qty_returned: line.qty_returned,
      qty_accepted: line.qty_accepted,
      reason_code: line.reason_code,
      reason_notes: line.reason_notes,
      unit_price: line.unit_price,
      line_credit_amount: line.line_credit_amount,
      inspection_notes: line.inspection_notes,
      inserted_at: line.inserted_at,
      updated_at: line.updated_at
    }
  end

  @doc """
  RMA file metadata + serve URL.
  """
  def customer_return_file(%Backend.CustomerReturns.CustomerReturnFile{} = f, rma) do
    rma_uuid = rma && Map.get(rma, :uuid)

    %{
      id: f.id,
      uuid: f.uuid,
      kind: f.kind,
      filename: f.filename,
      mime: f.mime,
      byte_size: f.byte_size,
      url:
        rma_uuid &&
          "/api/customer-returns/" <>
            rma_uuid <> "/files/" <> f.uuid <> "/serve",
      uploaded_at: f.inserted_at,
      uploaded_by: actor(f, :uploaded_by)
    }
  end

  # ---------------------------------------------------------------
  # Order wizard.
  # ---------------------------------------------------------------

  @doc """
  Snapshot payload for the wizard tab on a CO detail page. The
  shape mirrors the FE component tree: phase strip + next-action
  card + blockers + per-line MO state + open-PO list + timeline.
  """
  def order_wizard(snapshot) do
    %{
      customer_order: customer_order(snapshot.customer_order),
      phase: snapshot.phase,
      next_action: stringify_action(snapshot.next_action),
      blockers: snapshot.blockers,
      lines: Enum.map(snapshot.lines, &wizard_line/1),
      open_pos: Enum.map(snapshot.open_pos, &wizard_open_po/1),
      invoices: Enum.map(snapshot[:invoices] || [], &wizard_invoice/1),
      timeline: snapshot.timeline,
      signers: %{
        approver: wizard_signer(snapshot[:signers] && snapshot.signers[:approver]),
        director: wizard_signer(snapshot[:signers] && snapshot.signers[:director])
      }
    }
  end

  defp wizard_invoice(inv) do
    %{
      id: inv.id,
      uuid: inv.uuid,
      code: render_code(inv, "customer_invoice"),
      kind: inv.kind,
      status: inv.status,
      grand_total: decimal_to_string(inv.grand_total),
      currency_code: inv.currency_code,
      invoice_date: inv.invoice_date,
      due_date: inv.due_date
    }
  end

  defp wizard_signer(nil), do: nil

  defp wizard_signer(approval) do
    %{
      kind: approval.kind,
      signed_at: approval.signed_at,
      signed_by:
        approval.signed_by &&
          %{
            id: approval.signed_by.id,
            uuid: approval.signed_by.uuid,
            name: approval.signed_by.name
          },
      notes: approval.notes
    }
  end

  defp wizard_line(line) do
    %{
      uuid: line.uuid,
      id: line.id,
      item_id: line.item_id,
      item_name: line.item_name,
      qty_ordered: decimal_to_string(line.qty_ordered),
      needs_mo: line.needs_mo?,
      primary_mo: line.primary_mo && wizard_mo(line.primary_mo),
      mos: Enum.map(line.mos, &wizard_mo/1),
      available_boms: Map.get(line, :available_boms, [])
    }
  end

  defp wizard_mo(mo) do
    %{
      id: mo.id,
      uuid: mo.uuid,
      code: mo.code,
      status: mo.status,
      quantity: decimal_to_string(mo.quantity),
      item_name: mo.item_name,
      bookings_total: mo.bookings_total,
      placeholder_count: mo.placeholder_count,
      placeholder_awaiting_qc_count: mo.placeholder_awaiting_qc_count,
      placeholder_in_transit_count: mo.placeholder_in_transit_count,
      placeholder_not_sent_count: mo.placeholder_not_sent_count,
      has_placeholder_bookings: mo.has_placeholder_bookings?,
      broken_booking_count: mo.broken_booking_count,
      output_lot_count: mo.output_lot_count,
      output_at_feed_count: mo.output_at_feed_count,
      output_in_warehouse_count: mo.output_in_warehouse_count,
      output_qc_pending_count: mo.output_qc_pending_count,
      output_awaiting_release_count:
        Map.get(mo, :output_awaiting_release_count, 0),
      output_awaiting_release_lot_uuids:
        Map.get(mo, :output_awaiting_release_lot_uuids, []),
      output_release_move_needed_count:
        Map.get(mo, :output_release_move_needed_count, 0),
      output_release_move_needed_lot_uuids:
        Map.get(mo, :output_release_move_needed_lot_uuids, []),
      output_release_ready_count: Map.get(mo, :output_release_ready_count, 0),
      output_release_ready_lot_uuids:
        Map.get(mo, :output_release_ready_lot_uuids, []),
      output_needs_routing_count: Map.get(mo, :output_needs_routing_count, 0),
      output_needs_routing_lot_uuids:
        Map.get(mo, :output_needs_routing_lot_uuids, []),
      bookings_closeout_pending_count: mo.bookings_closeout_pending_count,
      has_output_at_production_feed: mo.has_output_at_production_feed?,
      cancelled_orphan_booking_count:
        Map.get(mo, :cancelled_orphan_booking_count, 0),
      purchasing_requested_at: mo.purchasing_requested_at,
      pickup_started_at: mo.pickup_started_at,
      pickup_started_by_name: mo.pickup_started_by_name,
      pickup_completed_at: mo.pickup_completed_at,
      preflight_complete: mo.preflight_complete?,
      is_fully_sorted: mo.is_fully_sorted?,
      due_date: mo.due_date,
      output_lots:
        Enum.map(mo.output_lots, fn lot ->
          %{
            uuid: lot.uuid,
            # Company-configured stock_lot code (e.g. L00173).
            # Falls back to nil when the numbering format for
            # "stock_lot" isn't set — FE then uses the batch or a
            # positional stub.
            code: render_code(lot, "stock_lot"),
            supplier_batch_no: Map.get(lot, :supplier_batch_no),
            status: lot.status,
            qty: decimal_to_string(lot.qty),
            at_production_feed: lot.at_production_feed?,
            needs_routing: Map.get(lot, :needs_routing?, false),
            ownership_kind: Map.get(lot, :ownership_kind, "own")
          }
        end),
      children: Enum.map(Map.get(mo, :children, []) || [], &wizard_mo/1)
    }
  end

  defp wizard_open_po(po) do
    %{
      id: po.id,
      uuid: po.uuid,
      status: po.status,
      expected_delivery_date: po.expected_delivery_date,
      grand_total: decimal_to_string(po.grand_total),
      currency_code: po.currency_code
    }
  end

  defp stringify_action(nil), do: nil

  defp stringify_action(action) do
    Map.put(action, :secondary_ctas, action.secondary_ctas || [])
  end

  @doc """
  One row on the /projects landing page. Compact summary — no
  per-line or per-MO breakdown; for that the operator clicks
  through to the wizard tab on the CO detail page.
  """
  def project_summary(s) do
    %{
      customer_order: customer_order(s.customer_order),
      phase: s.phase,
      next_action_title: s.next_action_title,
      next_action_detail: s.next_action_detail,
      next_action_cta: s.next_action_cta,
      blocker_count: s.blocker_count,
      line_count: s.line_count,
      mo_count: s.mo_count,
      lines_awaiting_mo: s.lines_awaiting_mo,
      mos_with_placeholders: s.mos_with_placeholders,
      mos_in_production: s.mos_in_production,
      mos_awaiting_closeout: s.mos_awaiting_closeout
    }
  end

  defp decimal_to_string(%Decimal{} = d), do: Decimal.to_string(d, :normal)
  defp decimal_to_string(nil), do: nil
  defp decimal_to_string(v), do: to_string(v)

  # Round a qty Decimal down to Decimal(20,10) storage precision.
  # Any digit past position 10 is sub-storage noise (a picoscale
  # residue of BOM.qty x MO.quantity) — carrying it into the FE
  # subtraction lights the row up as short by 2.5e-11 kg and pops
  # an add-booking modal for a qty the operator can't book.
  defp normalise_qty_to_storage_precision(%Decimal{} = d),
    do: Decimal.round(d, 10, :half_up)

  defp normalise_qty_to_storage_precision(other), do: other

  # ---------------------------------------------------------------
  # Loyalty.
  # ---------------------------------------------------------------

  @doc "Loyalty program with embedded tiers (sorted by min_threshold ASC)."
  def loyalty_program(p) do
    %{
      id: p.id,
      uuid: p.uuid,
      code: render_code(p, "loyalty_program"),
      name: p.name,
      description: p.description,
      scheme: p.scheme,
      basis: p.basis,
      payout_kind: p.payout_kind,
      is_active: p.is_active,
      is_default: p.is_default,
      activated_at: p.activated_at,
      deactivated_at: p.deactivated_at,
      deactivation_reason: p.deactivation_reason,
      tiers: preloaded_list(p, :tiers, &loyalty_tier/1),
      created_by: actor(p, :created_by),
      updated_by: actor(p, :updated_by),
      inserted_at: p.inserted_at,
      updated_at: p.updated_at
    }
  end

  def loyalty_tier(t) do
    %{
      id: t.id,
      uuid: t.uuid,
      loyalty_program_id: t.loyalty_program_id,
      rank: t.rank,
      min_threshold: Decimal.to_string(t.min_threshold, :normal),
      rate_pct: Decimal.to_string(t.rate_pct, :normal),
      label: t.label,
      inserted_at: t.inserted_at,
      updated_at: t.updated_at
    }
  end

  @doc "Single ledger row — preloaded with FK summaries."
  def customer_credit(c) do
    %{
      id: c.id,
      uuid: c.uuid,
      code: render_code(c, "customer_credit"),
      customer: customer_compact_or_nil(c),
      customer_id: c.customer_id,
      kind: c.kind,
      amount: Decimal.to_string(c.amount, :normal),
      currency_code: c.currency_code,
      reason: c.reason,
      loyalty_program:
        case Map.get(c, :loyalty_program) do
          %Backend.Loyalty.LoyaltyProgram{} = p ->
            %{id: p.id, uuid: p.uuid, name: p.name}

          _ ->
            nil
        end,
      loyalty_program_id: c.loyalty_program_id,
      loyalty_program_tier_id: c.loyalty_program_tier_id,
      source_invoice:
        case Map.get(c, :source_invoice) do
          %Backend.CustomerInvoices.CustomerInvoice{} = inv ->
            %{
              id: inv.id,
              uuid: inv.uuid,
              code: render_code(inv, "customer_invoice"),
              kind: inv.kind,
              status: inv.status,
              grand_total: inv.grand_total
            }

          _ ->
            nil
        end,
      source_invoice_id: c.source_invoice_id,
      credit_note_invoice:
        case Map.get(c, :credit_note_invoice) do
          %Backend.CustomerInvoices.CustomerInvoice{} = inv ->
            %{
              id: inv.id,
              uuid: inv.uuid,
              code: render_code(inv, "customer_invoice"),
              status: inv.status,
              grand_total: inv.grand_total
            }

          _ ->
            nil
        end,
      credit_note_invoice_id: c.credit_note_invoice_id,
      granted_by: actor(c, :granted_by),
      granted_by_id: c.granted_by_id,
      inserted_at: c.inserted_at,
      updated_at: c.updated_at
    }
  end

  defp customer_compact_or_nil(%{customer: %Backend.Customers.Customer{} = c}) do
    %{id: c.id, uuid: c.uuid, name: c.name, code: render_code(c, "customer")}
  end

  defp customer_compact_or_nil(_), do: nil

  @doc """
  Per-customer aggregate row used by the loyalty dashboard
  leaderboard. The controller hydrates `customer` before calling.
  """
  def loyalty_per_customer(row) do
    %{
      customer: row.customer,
      currency_code: row.currency_code,
      balance: Decimal.to_string(ensure_decimal_payload(row.balance), :normal),
      total_earned:
        Decimal.to_string(ensure_decimal_payload(row.total_earned), :normal),
      total_applied:
        Decimal.to_string(ensure_decimal_payload(row.total_applied), :normal)
    }
  end

  defp ensure_decimal_payload(%Decimal{} = d), do: d
  defp ensure_decimal_payload(n) when is_integer(n), do: Decimal.new(n)
  defp ensure_decimal_payload(n) when is_float(n), do: Decimal.from_float(n)
  defp ensure_decimal_payload(n) when is_binary(n), do: Decimal.new(n)
  defp ensure_decimal_payload(_), do: Decimal.new(0)

  @doc """
  Sales-management dashboard payload. All money values are stringified
  Decimals in the company base currency.
  """
  def sales_management(snapshot, company) do
    %{
      base_currency: company.currency_code,
      excluded_currencies: snapshot.excluded_currencies,
      leaderboard:
        Enum.map(snapshot.leaderboard, fn r ->
          %{
            manager_id: r.manager_id,
            manager_name: r.manager_name,
            customers_count: r.customers_count,
            active_customers_count: r.active_customers_count,
            approved_customers_count: r.approved_customers_count,
            revenue_ytd: Decimal.to_string(r.revenue_ytd, :normal),
            outstanding_ar: Decimal.to_string(r.outstanding_ar, :normal),
            pipeline_value: Decimal.to_string(r.pipeline_value, :normal)
          }
        end),
      funnel:
        Enum.map(snapshot.funnel, fn r ->
          %{
            stage: r.stage,
            count: r.count,
            total_value: Decimal.to_string(r.total_value, :normal)
          }
        end),
      unassigned:
        Enum.map(snapshot.unassigned, fn r ->
          %{
            id: r.id,
            uuid: r.uuid,
            name: r.name,
            approval_status: r.approval_status,
            last_contact_at: r.last_contact_at,
            total_orders_count: r.total_orders_count
          }
        end)
    }
  end

  @doc """
  Sales statistics payload. All money values are stringified Decimals
  in the company base currency; quantities also stringified.
  """
  def statistics(snapshot, company) do
    %{
      months: snapshot.months,
      base_currency: company.currency_code,
      excluded_currencies: snapshot.excluded_currencies,
      kpis: %{
        revenue_this_month: Decimal.to_string(snapshot.kpis.revenue_this_month, :normal),
        revenue_ytd: Decimal.to_string(snapshot.kpis.revenue_ytd, :normal),
        revenue_prior_ytd: Decimal.to_string(snapshot.kpis.revenue_prior_ytd, :normal),
        revenue_prior_year_full:
          Decimal.to_string(snapshot.kpis.revenue_prior_year_full, :normal),
        avg_invoice_value: Decimal.to_string(snapshot.kpis.avg_invoice_value, :normal),
        invoices_sent_count: snapshot.kpis.invoices_sent_count,
        active_customers: snapshot.kpis.active_customers
      },
      revenue_by_month:
        Enum.map(snapshot.revenue_by_month, fn m ->
          %{
            month_start: m.month_start,
            invoice_revenue: Decimal.to_string(m.invoice_revenue, :normal),
            credit_notes: Decimal.to_string(m.credit_notes, :normal),
            net: Decimal.to_string(m.net, :normal)
          }
        end),
      top_customers:
        Enum.map(snapshot.top_customers, fn r ->
          %{
            customer_id: r.customer_id,
            customer_name: r.customer_name,
            revenue: Decimal.to_string(r.revenue, :normal),
            monthly_series: Enum.map(r.monthly_series, &Decimal.to_string(&1, :normal))
          }
        end),
      top_items:
        Enum.map(snapshot.top_items, fn r ->
          %{
            item_id: r.item_id,
            item_uuid: r.item_uuid,
            item_name: r.item_name,
            revenue: Decimal.to_string(r.revenue, :normal),
            qty: Decimal.to_string(r.qty, :normal)
          }
        end),
      funnel: %{
        lead: snapshot.funnel.lead,
        prospect: snapshot.funnel.prospect,
        active: snapshot.funnel.active,
        dormant: snapshot.funnel.dormant,
        inactive: snapshot.funnel.inactive
      }
    }
  end

  @doc """
  Cash-flow forecast payload. All money values are stringified
  Decimals in the company base currency.
  """
  def cash_flow(forecast, company) do
    %{
      weeks_ahead: forecast.weeks_ahead,
      base_currency: company.currency_code,
      excluded_currencies: forecast.excluded_currencies,
      buckets:
        Enum.map(forecast.buckets, fn b ->
          %{
            week_index: b.week_index,
            week_start: b.week_start,
            ar_due: Decimal.to_string(b.ar_due, :normal),
            ar_projected: Decimal.to_string(b.ar_projected, :normal),
            ap_due: Decimal.to_string(b.ap_due, :normal),
            ap_planned: Decimal.to_string(b.ap_planned, :normal),
            net: Decimal.to_string(b.net, :normal),
            cumulative: Decimal.to_string(b.cumulative, :normal)
          }
        end),
      overdue: %{
        ar_due: Decimal.to_string(forecast.overdue.ar_due, :normal),
        ar_projected: Decimal.to_string(forecast.overdue.ar_projected, :normal),
        ap_due: Decimal.to_string(forecast.overdue.ap_due, :normal),
        ap_planned: Decimal.to_string(forecast.overdue.ap_planned, :normal),
        net: Decimal.to_string(forecast.overdue.net, :normal)
      },
      totals: %{
        outstanding_ar: Decimal.to_string(forecast.totals.outstanding_ar, :normal),
        projected_ar: Decimal.to_string(forecast.totals.projected_ar, :normal),
        outstanding_ap: Decimal.to_string(forecast.totals.outstanding_ap, :normal),
        planned_ap: Decimal.to_string(forecast.totals.planned_ap, :normal),
        net_position: Decimal.to_string(forecast.totals.net_position, :normal)
      }
    }
  end

  @doc """
  Per-row shape for the "Today's contacts" CRM page. Carries enough
  context for the salesperson to act: who the customer is, where
  they are in the lifecycle, when we last spoke, when the cadence
  was supposed to ring, and how many days late we are.
  """
  def today_customer(c) do
    today = Date.utc_today()

    days_overdue =
      case c.next_contact_at do
        nil ->
          nil

        %DateTime{} = at ->
          diff = Date.diff(today, DateTime.to_date(at))
          if diff > 0, do: diff, else: 0
      end

    days_since_contact =
      case c.last_contact_at do
        nil -> nil
        %DateTime{} = at -> Date.diff(today, DateTime.to_date(at))
      end

    %{
      id: c.id,
      uuid: c.uuid,
      code: render_code(c, "customer"),
      name: c.name,
      currency_code: c.currency_code,
      approval_status: c.approval_status,
      effective_approval_status:
        elem(Backend.Customers.effective_approval_status(c), 0),
      status: Backend.Customers.status_projection(c) |> Atom.to_string(),
      last_contact_at: c.last_contact_at,
      next_contact_at: c.next_contact_at,
      contact_frequency_months: c.contact_frequency_months,
      total_orders_count: c.total_orders_count,
      days_overdue: days_overdue,
      days_since_contact: days_since_contact
    }
  end

  @doc """
  Picker-shaped summary — id/uuid/name/code + the bits Customer Order
  forms will need to surface the right customer to the right line:
  currency, payment terms, approval status (greyed-out tile when not
  approved).
  """
  def customer_summary(c) do
    %{
      id: c.id,
      uuid: c.uuid,
      code: render_code(c, "customer"),
      name: c.name,
      currency_code: c.currency_code,
      payment_terms_days: c.payment_terms_days,
      payment_terms_basis: c.payment_terms_basis,
      approval_status: c.approval_status,
      effective_approval_status:
        elem(Backend.Customers.effective_approval_status(c), 0),
      is_active: c.is_active,
      status: Backend.Customers.status_projection(c) |> Atom.to_string()
    }
  end

  @doc """
  A single phone / mobile / email / fax row on a customer.
  """
  def customer_contact(row) do
    %{
      uuid: row.uuid,
      customer_id: row.customer_id,
      kind: row.kind,
      value: row.value,
      label: row.label,
      is_primary: row.is_primary,
      inserted_at: row.inserted_at,
      updated_at: row.updated_at
    }
  end

  @doc """
  A single touch-point event (call / email / meeting / message).
  Append-only — there's no update payload by design.
  """
  def customer_contact_event(row) do
    %{
      uuid: row.uuid,
      customer_id: row.customer_id,
      kind: row.kind,
      occurred_at: row.occurred_at,
      summary: row.summary,
      logged_by: actor(row, :logged_by),
      inserted_at: row.inserted_at
    }
  end

  @doc """
  Public payload for a stored customer file. Includes the serve URL
  the FE can fetch bytes from. `customer` is the parent so the URL
  is scoped — files only resolve under their owning customer.
  """
  def customer_file(%Backend.Customers.CustomerFile{} = f, customer) do
    customer_uuid = customer && Map.get(customer, :uuid)

    %{
      id: f.id,
      uuid: f.uuid,
      kind: f.kind,
      filename: f.filename,
      mime: f.mime,
      byte_size: f.byte_size,
      url:
        customer_uuid &&
          "/api/customers/" <>
            customer_uuid <> "/files/" <> f.uuid <> "/serve",
      uploaded_at: f.inserted_at,
      uploaded_by: actor(f, :uploaded_by)
    }
  end

  @doc """
  Public payload for an item-scoped compliance file. Same shape as
  `vendor_file/2` so the FE upload widget can be re-used. `parent`
  is the owning item — its uuid is what the serve URL is scoped to.
  """
  def item_file(%Backend.Items.ItemFile{} = f, parent) do
    parent_uuid = parent && Map.get(parent, :uuid)

    %{
      id: f.id,
      uuid: f.uuid,
      kind: f.kind,
      filename: f.filename,
      mime: f.mime,
      byte_size: f.byte_size,
      url:
        parent_uuid &&
          "/api/items/" <> parent_uuid <> "/files/" <> f.uuid <> "/serve",
      uploaded_at: f.inserted_at,
      uploaded_by: actor(f, :uploaded_by)
    }
  end

  # Renders a preloaded ItemFile belongs_to assoc if present.
  # Compliance-subtable renderers below pass the owning Item so the
  # serve URL is scoped correctly.
  defp maybe_item_file(parent, assoc, item) when is_atom(assoc) do
    case Map.get(parent, assoc) do
      %Backend.Items.ItemFile{} = f -> item_file(f, item)
      _ -> nil
    end
  end

  defp maybe_item_summary(%Backend.Items.Item{} = i) do
    # ``servings_per_pack`` + ``dosage_form`` come from the item's
    # ``finished_product_spec`` sub-row. Both nullable — legacy items
    # or non-finished-product items simply won't render the FE's
    # "N servings" caption. Assoc-not-loaded degrades to nil (payload
    # stays valid; caller just gets less context).
    spec = Map.get(i, :finished_product_spec)

    {servings_per_pack, dosage_form} =
      case spec do
        %Backend.Items.FinishedProductSpec{} = s ->
          {s.servings_per_pack, s.dosage_form}

        _ ->
          {nil, nil}
      end

    %{
      id: i.id,
      uuid: i.uuid,
      code: render_code(i, "item"),
      name: i.name,
      item_type: i.item_type,
      external_sku: i.external_sku,
      # Compliance + storage hints surfaced for the mobile pre-receive
      # checklist (and any other "what should we expect on this PO" view).
      # Defensive defaults so legacy / draft items don't break the
      # payload.
      compliance_status: Map.get(i, :compliance_status) || "draft",
      storage_tags: Map.get(i, :storage_tags) || [],
      attributes: Map.get(i, :attributes) || %{},
      stock_uom: maybe_uom_compact(Map.get(i, :stock_uom)),
      # Finished-product spec bits used by the MO form to render a
      # human-friendly quantity caption ("0.05 packs · 3 gummies").
      # Both nullable — non-finished items or pre-spec legacy rows
      # get nil here and the FE gracefully skips the caption.
      servings_per_pack: servings_per_pack,
      dosage_form: dosage_form
    }
  end

  defp maybe_item_summary(_), do: nil

  defp maybe_uom_compact(%Backend.Units.UnitOfMeasurement{} = u) do
    %{
      id: u.id,
      uuid: u.uuid,
      code: render_code(u, "unit_of_measurement"),
      symbol: u.symbol,
      name: u.name
    }
  end

  defp maybe_uom_compact(_), do: nil

  @doc """
  Bill of Materials — header + every component row preloaded. The
  desktop detail page renders the full payload; the ledger uses
  `bom_summary/1` for the list row.
  """
  def bom(%Backend.Production.BOM{} = b) do
    %{
      id: b.id,
      uuid: b.uuid,
      code: render_code(b, "bom"),
      name: b.name,
      notes: b.notes,
      is_primary: b.is_primary,
      is_active: b.is_active,
      item_id: b.item_id,
      item: maybe_item_summary(b.item),
      lines: preloaded_list(b, :lines, &bom_line/1),
      # NPD provenance — the MO-create trust card compares
      # `npd_spec_sheet_uuid` + `npd_synced_at` against the CO's
      # `npd_spec_customer_signed_at` to detect drift ("BOM re-synced
      # after the customer signed the spec").
      npd_spec_sheet_uuid: b.npd_spec_sheet_uuid,
      npd_formulation_version_id: b.npd_formulation_version_id,
      npd_synced_at: b.npd_synced_at,
      inserted_at: b.inserted_at,
      updated_at: b.updated_at,
      created_by: actor(b, :created_by),
      updated_by: actor(b, :updated_by)
    }
  end

  def bom(_), do: nil

  def bom_line(%Backend.Production.BOMLine{} = l) do
    %{
      id: l.id,
      uuid: l.uuid,
      bom_id: l.bom_id,
      sort_order: l.sort_order,
      qty: l.qty,
      is_fixed: l.is_fixed,
      notes: l.notes,
      part_id: l.part_id,
      part: maybe_item_summary(l.part),
      unit_of_measurement_id: l.unit_of_measurement_id,
      unit_of_measurement: maybe_uom_compact(l.unit_of_measurement)
    }
  end

  def bom_line(_), do: nil

  @doc """
  Slim BOM row for the ledger — strips notes + line details so the
  table query stays light.
  """
  def bom_summary(%Backend.Production.BOM{} = b) do
    %{
      id: b.id,
      uuid: b.uuid,
      code: render_code(b, "bom"),
      name: b.name,
      is_primary: b.is_primary,
      is_active: b.is_active,
      item: maybe_item_summary(b.item),
      created_by: actor(b, :created_by),
      updated_by: actor(b, :updated_by),
      inserted_at: b.inserted_at,
      updated_at: b.updated_at,
      # NPD provenance — mirrored on the summary so the MO-form BOM
      # picker's trust card can render "signed by X on Y" without a
      # follow-up fetch of the full BOM.
      npd_spec_sheet_uuid: b.npd_spec_sheet_uuid,
      npd_formulation_version_id: b.npd_formulation_version_id,
      npd_synced_at: b.npd_synced_at
    }
  end

  def bom_summary(_), do: nil

  # Small CO summary attached to the MO payload so the "trust card"
  # on the MO-create form can compare BOM sync time against customer
  # signature time without a follow-up fetch. Matches on
  # `npd_formulation_uuid` and always picks the primary
  # (`sample_kind = false`) row — trial-batch sample sub-COs share
  # the formulation uuid but their spec metadata mirrors the parent
  # anyway.
  defp linked_customer_order_for_mo(%Backend.Production.ManufacturingOrder{
         npd_formulation_uuid: uuid,
         company_id: company_id
       })
       when is_binary(uuid) do
    import Ecto.Query, only: [from: 2]

    query =
      from co in Backend.CustomerOrders.CustomerOrder,
        where:
          co.company_id == ^company_id and
            co.npd_formulation_uuid == ^uuid and
            co.sample_kind == false,
        select: %{
          uuid: co.uuid,
          npd_spec_sheet_uuid: co.npd_spec_sheet_uuid,
          npd_spec_sheet_url: co.npd_spec_sheet_url,
          npd_spec_prepared_by_name: co.npd_spec_prepared_by_name,
          npd_spec_prepared_at: co.npd_spec_prepared_at,
          npd_spec_director_name: co.npd_spec_director_name,
          npd_spec_approved_at: co.npd_spec_approved_at,
          npd_spec_customer_signed_at: co.npd_spec_customer_signed_at,
          npd_spec_customer_signed_by_name: co.npd_spec_customer_signed_by_name
        },
        limit: 1

    Backend.Repo.one(query)
  end

  defp linked_customer_order_for_mo(_), do: nil

  @doc """
  One row from `bom_versions`. Snapshot stays opaque to the FE — the
  version-history card just needs version_no + when + who + notes;
  revert is a separate POST that loads the snapshot server-side.
  """
  def bom_version(%Backend.Production.BOMVersion{} = v) do
    %{
      id: v.id,
      uuid: v.uuid,
      version_no: v.version_no,
      notes: v.notes,
      created_by: actor(v, :created_by),
      inserted_at: v.inserted_at
    }
  end

  def bom_version(_), do: nil

  # ----- workstation groups ---------------------------------------

  @doc """
  Full workstation-group payload — every column the detail page +
  edit form read. Decimal hourly_rate is stringified so JS can hold
  the precision without coercing to float.
  """
  def workstation_group(%Backend.Production.WorkstationGroup{} = g) do
    %{
      id: g.id,
      uuid: g.uuid,
      code: render_code(g, "workstation_group"),
      name: g.name,
      notes: g.notes,
      # Capacity = count of active Workstation rows in this group.
      # Populated by Backend.Production read paths; defaults to 0
      # when callers haven't preloaded it.
      workstation_count: g.workstation_count || 0,
      kind: g.kind,
      hourly_rate_enabled: g.hourly_rate_enabled,
      hourly_rate: decimal_to_string(g.hourly_rate),
      custom_working_hours: g.custom_working_hours,
      working_hours: g.working_hours || %{},
      custom_holidays: g.custom_holidays,
      holidays: g.holidays || [],
      color: g.color,
      is_active: g.is_active,
      default_operation_notes: g.default_operation_notes,
      created_by: actor(g, :created_by),
      updated_by: actor(g, :updated_by),
      inserted_at: g.inserted_at,
      updated_at: g.updated_at
    }
  end

  def workstation_group(_), do: nil

  @doc """
  Slim workstation-group row for the ledger.
  """
  def workstation_group_summary(%Backend.Production.WorkstationGroup{} = g) do
    %{
      id: g.id,
      uuid: g.uuid,
      code: render_code(g, "workstation_group"),
      name: g.name,
      kind: g.kind,
      workstation_count: g.workstation_count || 0,
      hourly_rate_enabled: g.hourly_rate_enabled,
      hourly_rate: decimal_to_string(g.hourly_rate),
      color: g.color,
      is_active: g.is_active,
      default_operation_notes: g.default_operation_notes,
      # Group's own default OR a station-level fallback. Routing /
      # MO prefill reads this so a default typed on any station in
      # the group still flows through, even when the group itself
      # hasn't been given a default.
      effective_default_operation_notes:
        Backend.Production.effective_group_operation_notes(g),
      created_by: actor(g, :created_by),
      updated_by: actor(g, :updated_by),
      inserted_at: g.inserted_at,
      updated_at: g.updated_at
    }
  end

  def workstation_group_summary(_), do: nil

  # ----- workstations ----------------------------------------------

  @doc """
  Full workstation payload — detail page reads. Embeds the group +
  warehouse summaries the FE form needs without an extra round-trip,
  plus the M2M `default_workers` list as a flat user-summary array.
  Inherited hourly rate is also surfaced (`effective_hourly_rate`) so
  the FE form's read-only display lines up with how the scheduler
  resolves it.
  """
  def workstation(%Backend.Production.Workstation{} = w) do
    %{
      id: w.id,
      uuid: w.uuid,
      code: render_code(w, "workstation"),
      external_id: w.external_id,
      name: w.name,
      notes: w.notes,
      workstation_group_id: w.workstation_group_id,
      workstation_group: workstation_group_summary(w.workstation_group),
      warehouse_id: w.warehouse_id,
      warehouse: maybe_site_summary(w.warehouse),
      hourly_rate_enabled: w.hourly_rate_enabled,
      hourly_rate: decimal_to_string(w.hourly_rate),
      effective_hourly_rate: workstation_effective_rate(w),
      productivity: decimal_to_string(w.productivity),
      idle_from: w.idle_from,
      idle_to: w.idle_to,
      is_active: w.is_active,
      default_operation_notes: w.default_operation_notes,
      # Inherited from the group when the station hasn't set its own.
      # Surfaced so the FE can show a "currently using group default"
      # hint next to an empty field on the station form.
      effective_operation_notes: workstation_effective_operation_notes(w),
      default_workers: workstation_default_workers(w),
      # Vita-performance integration cut-over flag — controls whether
      # kiosk sessions for this workstation attribute back to PSP.
      psp_source_of_truth: w.psp_source_of_truth,
      created_by: actor(w, :created_by),
      updated_by: actor(w, :updated_by),
      inserted_at: w.inserted_at,
      updated_at: w.updated_at
    }
  end

  def workstation(_), do: nil

  @doc "Slim workstation row for the ledger."
  def workstation_summary(%Backend.Production.Workstation{} = w) do
    %{
      id: w.id,
      uuid: w.uuid,
      code: render_code(w, "workstation"),
      name: w.name,
      workstation_group: workstation_group_summary(w.workstation_group),
      warehouse: maybe_site_summary(w.warehouse),
      productivity: decimal_to_string(w.productivity),
      hourly_rate_enabled: w.hourly_rate_enabled,
      hourly_rate: decimal_to_string(w.hourly_rate),
      is_active: w.is_active,
      idle_from: w.idle_from,
      idle_to: w.idle_to,
      # Ledger badge signal — is this station cut over to vp?
      psp_source_of_truth: w.psp_source_of_truth,
      inserted_at: w.inserted_at,
      updated_at: w.updated_at
    }
  end

  def workstation_summary(_), do: nil

  # ----- machines --------------------------------------------------

  @doc """
  Detailed machine payload for the form + detail page.

  `calibration_overdue` is a computed truthy signal so the FE badge
  logic doesn't need to know the today-vs-due-date rule.
  """
  def machine(%Backend.Production.Machine{} = m) do
    %{
      id: m.id,
      uuid: m.uuid,
      name: m.name,
      notes: m.notes,
      workstation_id: m.workstation_id,
      workstation: workstation_summary(m.workstation),
      hourly_rate_enabled: m.hourly_rate_enabled,
      hourly_rate: decimal_to_string(m.hourly_rate),
      asset_tag: m.asset_tag,
      serial_number: m.serial_number,
      manufacturer: m.manufacturer,
      model: m.model,
      commissioned_at: m.commissioned_at,
      last_calibrated_at: m.last_calibrated_at,
      next_calibration_due_at: m.next_calibration_due_at,
      calibration_frequency_months: m.calibration_frequency_months,
      calibration_overdue: machine_calibration_overdue?(m),
      is_active: m.is_active,
      created_by: actor(m, :created_by),
      updated_by: actor(m, :updated_by),
      inserted_at: m.inserted_at,
      updated_at: m.updated_at
    }
  end

  def machine(_), do: nil

  @doc "Slim machine row for the ledger + workstation form's attached-machines list."
  def machine_summary(%Backend.Production.Machine{} = m) do
    %{
      id: m.id,
      uuid: m.uuid,
      name: m.name,
      workstation: workstation_summary(m.workstation),
      hourly_rate_enabled: m.hourly_rate_enabled,
      hourly_rate: decimal_to_string(m.hourly_rate),
      asset_tag: m.asset_tag,
      manufacturer: m.manufacturer,
      model: m.model,
      last_calibrated_at: m.last_calibrated_at,
      next_calibration_due_at: m.next_calibration_due_at,
      calibration_overdue: machine_calibration_overdue?(m),
      is_active: m.is_active,
      inserted_at: m.inserted_at,
      updated_at: m.updated_at
    }
  end

  def machine_summary(_), do: nil

  defp machine_calibration_overdue?(%Backend.Production.Machine{
         is_active: true,
         next_calibration_due_at: %Date{} = due
       }) do
    Date.compare(due, Date.utc_today()) == :lt
  end

  defp machine_calibration_overdue?(_), do: false

  # ----- workstation sessions --------------------------------------

  @doc """
  Serialize a list of WorkstationSession rows for the timeline UI.
  Batches the employee-name lookup so a hundred-session timeline
  fires one HR query instead of one per row.

  Session status legend for the FE:
    * "active"    — currently running; render live-timer, no duration
    * "completed" — finished at kiosk; duration + qty + performance
    * "verified"  — QC-approved after the fact
  """
  def workstation_sessions(sessions) when is_list(sessions) do
    employee_names = load_employee_names(sessions)
    Enum.map(sessions, &workstation_session(&1, employee_names))
  end

  defp load_employee_names(sessions) do
    uuids =
      sessions
      |> Enum.flat_map(fn s -> s.employee_uuids || [] end)
      |> Enum.uniq()

    if uuids == [] do
      %{}
    else
      import Ecto.Query
      alias Backend.HR.Employee
      alias Backend.Repo

      Repo.all(
        from e in Employee,
          where: e.uuid in ^uuids,
          select: {e.uuid, e.full_name}
      )
      |> Enum.into(%{}, fn {u, n} -> {to_string(u), n} end)
    end
  end

  defp workstation_session(s, employee_names) do
    started = s.started_at
    finished = s.finished_at

    duration_s =
      case {started, finished} do
        {%DateTime{} = a, %DateTime{} = b} -> DateTime.diff(b, a, :second)
        _ -> nil
      end

    step = Map.get(s, :manufacturing_order_step)

    step_summary =
      case step do
        %Backend.Production.ManufacturingOrderStep{} = st ->
          group = Map.get(st, :workstation_group)
          mo = Map.get(st, :manufacturing_order)

          %{
            uuid: st.uuid,
            operation_description: st.operation_description,
            sort_order: st.sort_order,
            workstation_group_name: group && group.name,
            manufacturing_order_uuid: mo && mo.uuid,
            manufacturing_order_id: mo && mo.id
          }

        _ ->
          nil
      end

    workstation_summary =
      case Map.get(s, :workstation) do
        %Backend.Production.Workstation{} = w ->
          %{uuid: w.uuid, name: w.name, code: render_code(w, "workstation")}

        _ ->
          nil
      end

    worker_names =
      (s.employee_uuids || [])
      |> Enum.map(fn uuid -> Map.get(employee_names, to_string(uuid), "Unknown") end)

    %{
      uuid: s.uuid,
      external_id: s.external_id,
      activity_kind: s.activity_kind,
      activity_label: s.activity_label,
      status: s.status,
      started_at: started,
      finished_at: finished,
      duration_seconds: duration_s,
      quantity_produced: s.quantity_produced && to_string(s.quantity_produced),
      quantity_rejected: s.quantity_rejected && to_string(s.quantity_rejected),
      performance_percentage: s.performance_percentage,
      notes: s.notes,
      workers: worker_names,
      worker_uuids: Enum.map(s.employee_uuids || [], &to_string/1),
      workstation: workstation_summary,
      manufacturing_order_step: step_summary,
      inserted_at: s.inserted_at
    }
  end

  # ----- routings --------------------------------------------------

  @doc """
  Full routing payload — header + ordered steps + per-step worker
  summaries. Decimals stringified so JS keeps full precision.
  """
  def routing(%Backend.Production.Routing{} = r) do
    %{
      id: r.id,
      uuid: r.uuid,
      code: render_code(r, "routing"),
      name: r.name,
      notes: r.notes,
      is_active: r.is_active,
      company_id: r.company_id,
      item_id: r.item_id,
      item: maybe_item_summary(r.item),
      bom_id: r.bom_id,
      bom: bom_summary(r.bom),
      other_fixed_cost: decimal_to_string(r.other_fixed_cost),
      other_variable_cost: decimal_to_string(r.other_variable_cost),
      other_variable_cost_basis: decimal_to_string(r.other_variable_cost_basis),
      steps: routing_steps_list(r),
      created_by: actor(r, :created_by),
      updated_by: actor(r, :updated_by),
      inserted_at: r.inserted_at,
      updated_at: r.updated_at
    }
  end

  def routing(_), do: nil

  @doc "Slim routing row for the ledger."
  def routing_summary(%Backend.Production.Routing{} = r) do
    %{
      id: r.id,
      uuid: r.uuid,
      code: render_code(r, "routing"),
      name: r.name,
      is_active: r.is_active,
      item: maybe_item_summary(r.item),
      bom: bom_summary(r.bom),
      created_by: actor(r, :created_by),
      updated_by: actor(r, :updated_by),
      inserted_at: r.inserted_at,
      updated_at: r.updated_at
    }
  end

  def routing_summary(_), do: nil

  def routing_step(%Backend.Production.RoutingStep{} = s) do
    %{
      id: s.id,
      uuid: s.uuid,
      sort_order: s.sort_order,
      operation_description: s.operation_description,
      setup_time_min: decimal_to_string(s.setup_time_min),
      cycle_time_min: decimal_to_string(s.cycle_time_min),
      fixed_cost: decimal_to_string(s.fixed_cost),
      variable_cost: decimal_to_string(s.variable_cost),
      capacity: decimal_to_string(s.capacity),
      workstation_group_id: s.workstation_group_id,
      workstation_group: workstation_group_summary(s.workstation_group),
      workers: routing_step_workers(s)
    }
  end

  def routing_step(_), do: nil

  # ----- manufacturing orders --------------------------------------

  @doc """
  Full MO payload — detail page reads. Includes computed
  `approximate_cost` (sum of bom_line.qty × part.last_unit_cost ×
  mo.quantity) so the FE shows the cost without a second fetch.
  """
  def manufacturing_order(%Backend.Production.ManufacturingOrder{} = mo) do
    {parts, materials_cost} = mo_parts_breakdown(mo)
    operations = mo_operations_breakdown(mo)
    {start_at, finish_at} = mo_planned_bounds(mo)

    stage = Backend.Production.mo_stage(mo)

    %{
      id: mo.id,
      uuid: mo.uuid,
      code: render_code(mo, "manufacturing_order"),
      status: mo.status,
      revision: mo.revision,
      # R&D stream marker. `production` = normal MOs, `trial` /
      # `sample` = R&D. Drives the R&D fast-path Run button on the
      # detail page (see mo-status-actions.tsx) + the row chip on
      # the ledger.
      project_type: mo.project_type,
      # Operator-facing macro stage (one of 8 canonical stages plus
      # ``:done`` / ``:cancelled``). Drives the horizontal stepper on
      # the MO detail page + a compact chip on cards / lists. The
      # 7-value ``status`` above is the approval-ceremony state
      # machine; ``stage`` is the operator's mental model of "what
      # step am I on right now". See ``Backend.Production.mo_stage/1``
      # for the derivation.
      stage: to_string(stage),
      stage_index: Backend.Production.mo_stage_index(stage),
      stage_total: Backend.Production.mo_stage_total(),
      # NPD linkage — populated only on trial/sample MOs created via
      # the NPD integration. `npd_trial_batch_uuid` is the dedupe key
      # NPD uses to open the matching validation; the FE reads it to
      # decide whether to render the validation-sheet embed on the
      # MO run page.
      npd_formulation_uuid: mo.npd_formulation_uuid,
      npd_trial_batch_uuid: mo.npd_trial_batch_uuid,
      npd_validation_uuid: mo.npd_validation_uuid,
      npd_validation_status: mo.npd_validation_status,
      npd_validation_synced_at: mo.npd_validation_synced_at,
      npd_validation_failure_reason: mo.npd_validation_failure_reason,
      # Linked customer order — trust-card summary the FE uses to
      # cross-check that the BOM being pulled matches the spec the
      # customer signed off on. Null when there is no CO for this
      # formulation (bare BOMs created directly on PSP).
      linked_customer_order: linked_customer_order_for_mo(mo),
      quantity: decimal_to_string(mo.quantity),
      due_date: mo.due_date,
      # Derived from steps — null when the MO is unscheduled.
      # Kept on the payload so existing FE callers don't have to
      # walk the steps themselves.
      start_at: start_at,
      finish_at: finish_at,
      expiry_date: mo.expiry_date,
      notes: mo.notes,
      warehouse_id: mo.warehouse_id,
      warehouse: mo_site_summary(mo.warehouse),
      item_id: mo.item_id,
      item: maybe_item_summary(mo.item),
      bom_id: mo.bom_id,
      bom: bom_summary(mo.bom),
      routing_id: mo.routing_id,
      routing: mo_routing_summary(mo.routing),
      parent_mo_id: mo.parent_mo_id,
      parent_mo: mo_parent_summary(Map.get(mo, :parent_mo)),
      children: mo_children_summary(Map.get(mo, :children)),
      # Shared-batch links. `consumer_links` = other MOs that pull
      # from this batch. `supplier_links` = batches that supply this
      # MO via a shared-batch merge.
      consumer_links: mo_consumer_links_payload(Map.get(mo, :consumer_links)),
      supplier_links: mo_supplier_links_payload(Map.get(mo, :supplier_links)),
      # Open children — drives the "Waiting on N sub-MO" pill in the
      # MO header. Completed / cancelled children don't count.
      blocking_children_count:
        Map.get(mo, :children)
        |> case do
          %Ecto.Association.NotLoaded{} -> 0
          list when is_list(list) ->
            Enum.count(list, &(&1.status not in ["completed", "cancelled"]))
          _ -> 0
        end,
      # Full root-to-leaf chain centered on this MO, so the FE can
      # render the production roadmap without an extra fetch.
      chain: mo_chain_summary(mo),
      assigned_to_id: mo.assigned_to_id,
      assigned_to: actor(mo, :assigned_to),
      approved_by_id: mo.approved_by_id,
      approved_by: actor(mo, :approved_by),
      approved_at: mo.approved_at,
      prepared_by_id: mo.prepared_by_id,
      prepared_by: actor(mo, :prepared_by),
      prepared_at: mo.prepared_at,
      rejection_reason: mo.rejection_reason,
      # Warehouse-pickup state — null timestamps mean the MO hasn't
      # entered the corresponding step yet. FE projects the state
      # from these stamps: released = released_to_warehouse_at != nil,
      # picking-in-progress = pickup_started_at != nil and
      # pickup_completed_at == nil, handed-off = pickup_completed_at != nil.
      released_to_warehouse_at: mo.released_to_warehouse_at,
      released_to_warehouse_by: actor(mo, :released_to_warehouse_by),
      # Replan flag — when set, this MO bounced back from
      # scheduled/in-progress because something broke the plan
      # (Output QC fail, peer over-consumed, lot rejected). UI shows
      # a "Needs replan" badge + banner; release is blocked until
      # the planner calls /clear-replan after fixing the bookings.
      needs_replan: mo.needs_replan,
      needs_replan_reason: mo.needs_replan_reason,
      needs_replan_at: mo.needs_replan_at,
      # Procurement request flag — when set, this MO has been sent
      # to procurement for missing items. Bookings are locked until
      # the planner prepares the MO or cancels the request.
      purchasing_requested_at: mo.purchasing_requested_at,
      purchasing_requested_by: actor(mo, :purchasing_requested_by),
      pickup_window_hours: mo.pickup_window_hours,
      pickup_started_at: mo.pickup_started_at,
      pickup_started_by: actor(mo, :pickup_started_by),
      pickup_completed_at: mo.pickup_completed_at,
      pickup_completed_by: actor(mo, :pickup_completed_by),
      production_cell_id: mo.production_cell_id,
      production_cell: mo_production_cell_payload(Map.get(mo, :production_cell)),
      # Production-run sign-off. Surfaced on the payload so the
      # Production runs tab can show the live progress without an
      # extra fetch.
      actual_start: mo.actual_start,
      actual_finish: mo.actual_finish,
      quantity_produced: decimal_to_string(mo.quantity_produced),
      produced_lot_id: mo.produced_lot_id,
      # Target lot code — rendered at MO create against the placeholder
      # `reserved` stock_lot so the design team can print labels ahead
      # of the physical run. Stays stable through completion (the
      # first pack adopts the same PK ⇒ same code). Null when the MO
      # has no reserved lot (legacy MOs created before the reservation
      # flow shipped).
      target_lot_code: mo_target_lot_code(mo),
      approximate_cost: decimal_to_string(materials_cost),
      materials_cost: decimal_to_string(materials_cost),
      cost_per_unit: mo_cost_per_unit(materials_cost, mo.quantity),
      parts: parts,
      operations: operations,
      # Broken-booking detection. Empty list = clean. Non-empty =
      # planner needs to either pass QC on the affected lot OR pull
      # the MO back to `approved` and re-book / spawn a child MO.
      # The list shape mirrors what `Production.list_broken_bookings_for/1`
      # returns so the FE can render the table row-by-row without a
      # second fetch.
      broken_bookings: mo_broken_bookings_payload(mo),
      # Counts so the detail page can drive the same red chips +
      # release gating as the schedule view, without a separate
      # fetch. Computed live; cheap.
      broken_bookings_count:
        Backend.Production.broken_booking_counts_for([mo.id]) |> Map.get(mo.id, 0),
      under_booked_count:
        Backend.Production.under_booked_line_counts_for([mo.id]) |> Map.get(mo.id, 0),
      # Placeholder-booking projection — mirrors ``OrderWizard``'s
      # per-MO ``has_placeholder_bookings?``. A booking with a
      # ``purchase_order_line_id`` is bound to an in-flight PO whose
      # lot isn't ``available`` yet, so the ``ensure_all_booked_lots_available``
      # release gate would refuse pickup. Surfaced on the detail
      # payload so ``mo-status-actions.tsx`` can disable "Request
      # pickup" until real lots land — no more hopeful click →
      # 4xx bounce cycle.
      has_placeholder_bookings:
        case Map.get(mo, :bookings) do
          list when is_list(list) ->
            Enum.any?(list, &(not is_nil(Map.get(&1, :purchase_order_line_id))))

          _ ->
            false
        end,
      created_by: actor(mo, :created_by),
      updated_by: actor(mo, :updated_by),
      # Per-MO BOM override state. `bom_overrides` is the full list
      # (one row per delta) so the FE can render the header banner
      # + audit-style "who changed what" popover without re-fetching.
      # `can_override_bom` mirrors the server-side editable-status
      # gate so the FE hides edit affordances on approved+ MOs.
      bom_overrides: mo_bom_overrides_payload(mo),
      can_override_bom: Backend.Production.can_override_bom?(mo),
      inserted_at: mo.inserted_at,
      updated_at: mo.updated_at
    }
  end

  def manufacturing_order(_), do: nil

  defp mo_bom_overrides_payload(%Backend.Production.ManufacturingOrder{} = mo) do
    overrides =
      case Map.get(mo, :bom_overrides) do
        %Ecto.Association.NotLoaded{} -> Backend.Production.list_mo_bom_overrides(mo.id)
        list when is_list(list) -> list
        _ -> []
      end

    Enum.map(overrides, &mo_bom_override_summary/1)
  end

  defp mo_bom_override_summary(%Backend.Production.MOBOMOverride{} = ov) do
    %{
      uuid: ov.uuid,
      action: ov.action,
      bom_line_id: ov.bom_line_id,
      item_id: ov.item_id,
      part: maybe_item_summary(safe_part(ov)),
      from_qty: ov.from_qty && Decimal.to_string(ov.from_qty),
      to_qty: ov.to_qty && Decimal.to_string(ov.to_qty),
      is_fixed: ov.is_fixed,
      reason: ov.reason,
      created_by: actor_light(ov.created_by),
      created_at: ov.inserted_at
    }
  end

  # `added` overrides point at the item directly (`ov.part`); edits
  # and removes borrow the item from the master BOM line (`ov.bom_line.part`).
  defp safe_part(%Backend.Production.MOBOMOverride{} = ov) do
    cond do
      match?(%Backend.Items.Item{}, ov.part) -> ov.part
      match?(%Backend.Production.BOMLine{part: %Backend.Items.Item{}}, ov.bom_line) ->
        ov.bom_line.part
      true -> nil
    end
  end

  defp mo_broken_bookings_payload(%Backend.Production.ManufacturingOrder{id: id}) do
    Backend.Production.list_broken_bookings_for([id])
    |> Enum.map(&broken_booking_row/1)
  end

  defp broken_booking_row(r) do
    producing_mo =
      if r.producing_mo_id do
        %{
          id: r.producing_mo_id,
          uuid: r.producing_mo_uuid,
          code: render_code(%{id: r.producing_mo_id}, "manufacturing_order"),
          status: r.producing_mo_status
        }
      else
        nil
      end

    %{
      booking_uuid: r.booking_uuid,
      item_id: r.item_id,
      item_name: r.item_name,
      lot_uuid: r.lot_uuid,
      lot_code: render_code(%{id: r.lot_id}, "stock_lot"),
      lot_status: r.lot_status,
      lot_source_kind: r.lot_source_kind,
      lot_source_ref: r.lot_source_ref,
      producing_mo: producing_mo,
      booked_qty: r.booked_qty,
      on_hand_qty: r.on_hand_qty,
      total_booked_qty: r.total_booked_qty,
      reason: Atom.to_string(r.reason)
    }
  end

  @doc "Slim MO for the ledger."
  def manufacturing_order_summary(%Backend.Production.ManufacturingOrder{} = mo) do
    {start_at, finish_at} = mo_planned_bounds(mo)

    %{
      id: mo.id,
      uuid: mo.uuid,
      code: render_code(mo, "manufacturing_order"),
      status: mo.status,
      revision: mo.revision,
      # R&D stream marker on the ledger. `production` = normal MOs,
      # `trial` / `sample` = R&D (created from NPD trial batches). The
      # FE ledger tab strip flips a server filter based on this value
      # AND stamps a row chip so an R&D row leaking through the "All"
      # tab is unmistakable.
      project_type: mo.project_type,
      quantity: decimal_to_string(mo.quantity),
      due_date: mo.due_date,
      start_at: start_at,
      finish_at: finish_at,
      item: maybe_item_summary(mo.item),
      bom: bom_summary(mo.bom),
      warehouse: mo_site_summary(mo.warehouse),
      assigned_to: actor(mo, :assigned_to),
      prepared_by: actor(mo, :prepared_by),
      prepared_at: mo.prepared_at,
      approved_by: actor(mo, :approved_by),
      approved_at: mo.approved_at,
      # Surfaced on the summary so list pages (pickup queue, schedule)
      # can render a warning chip without fetching the full MO. The
      # MO must be stamped with this virtual field upstream
      # (Production.list_pickup_queue / list_schedule_operations do
      # this); raw MOs without a stamp report 0.
      broken_bookings_count: Map.get(mo, :broken_bookings_count) || 0,
      under_booked_count: Map.get(mo, :under_booked_count) || 0,
      needs_replan: mo.needs_replan,
      needs_replan_reason: mo.needs_replan_reason,
      created_by: actor(mo, :created_by),
      updated_by: actor(mo, :updated_by),
      inserted_at: mo.inserted_at,
      updated_at: mo.updated_at
    }
  end

  def manufacturing_order_summary(_), do: nil

  defp mo_site_summary(%Backend.Warehouses.Warehouse{} = w),
    do: %{
      id: w.id,
      uuid: w.uuid,
      code: render_code(w, "warehouse"),
      name: w.name,
      kind: w.kind
    }

  defp mo_site_summary(_), do: nil

  defp mo_routing_summary(%Backend.Production.Routing{} = r),
    do: %{
      id: r.id,
      uuid: r.uuid,
      code: render_code(r, "routing"),
      name: r.name
    }

  defp mo_routing_summary(_), do: nil

  defp mo_parent_summary(%Backend.Production.ManufacturingOrder{} = mo) do
    %{
      id: mo.id,
      uuid: mo.uuid,
      code: render_code(mo, "manufacturing_order"),
      status: mo.status,
      quantity: decimal_to_string(mo.quantity),
      item: maybe_item_summary(mo.item)
    }
  end

  defp mo_parent_summary(_), do: nil

  defp mo_children_summary(list) when is_list(list) do
    list
    |> Enum.sort_by(& &1.inserted_at, NaiveDateTime)
    |> Enum.map(fn child ->
      {start_at, finish_at} = mo_planned_bounds(child)

      %{
        id: child.id,
        uuid: child.uuid,
        code: render_code(child, "manufacturing_order"),
        status: child.status,
        quantity: decimal_to_string(child.quantity),
        revision: child.revision,
        start_at: start_at,
        finish_at: finish_at,
        item: maybe_item_summary(child.item)
      }
    end)
  end

  defp mo_children_summary(_), do: []

  # Walk loaded steps for min(planned_start) + max(planned_finish).
  # Returns {nil, nil} when steps aren't loaded or all step times
  # are nil (unscheduled MO).
  defp mo_planned_bounds(%Backend.Production.ManufacturingOrder{steps: steps})
       when is_list(steps) and steps != [] do
    starts = for s <- steps, s.planned_start, do: s.planned_start
    finishes = for s <- steps, s.planned_finish, do: s.planned_finish

    case {starts, finishes} do
      {[], _} -> {nil, nil}
      {_, []} -> {nil, nil}
      {ss, fs} -> {Enum.min(ss, DateTime), Enum.max(fs, DateTime)}
    end
  end

  defp mo_planned_bounds(_), do: {nil, nil}

  defp mo_consumer_links_payload(list) when is_list(list) do
    Enum.map(list, fn link ->
      %{
        id: link.id,
        uuid: link.uuid,
        shared_qty: decimal_to_string(link.shared_qty),
        consumer_mo:
          case Map.get(link, :consumer_mo) do
            %Backend.Production.ManufacturingOrder{} = mo -> mo_parent_summary(mo)
            _ -> nil
          end
      }
    end)
  end

  defp mo_consumer_links_payload(_), do: []

  defp mo_supplier_links_payload(list) when is_list(list) do
    Enum.map(list, fn link ->
      %{
        id: link.id,
        uuid: link.uuid,
        shared_qty: decimal_to_string(link.shared_qty),
        batch_mo:
          case Map.get(link, :batch_mo) do
            %Backend.Production.ManufacturingOrder{} = mo -> mo_parent_summary(mo)
            _ -> nil
          end
      }
    end)
  end

  defp mo_supplier_links_payload(_), do: []

  defp mo_chain_summary(%Backend.Production.ManufacturingOrder{parent_mo_id: nil, children: %Ecto.Association.NotLoaded{}}),
    do: []

  defp mo_chain_summary(%Backend.Production.ManufacturingOrder{} = mo) do
    # Only do the chain walk when the MO is actually part of a tree.
    # A leaf with no parent and no children stays empty (the FE hides
    # the roadmap card).
    parent_id = mo.parent_mo_id

    children =
      case Map.get(mo, :children) do
        %Ecto.Association.NotLoaded{} -> []
        list when is_list(list) -> list
        _ -> []
      end

    if is_nil(parent_id) and children == [] do
      []
    else
      Backend.Production.mo_chain(mo)
      |> Enum.map(fn node ->
        %{
          id: node.id,
          uuid: node.uuid,
          code: render_code(node, "manufacturing_order"),
          status: node.status,
          quantity: decimal_to_string(node.quantity),
          parent_mo_id: node.parent_mo_id,
          item: maybe_item_summary(node.item)
        }
      end)
    end
  end

  defp mo_chain_summary(_), do: []

  # Build the parts breakdown the MO detail page renders. Each BOM
  # line is a master row (required qty, unit cost, total) with the
  # individual bookings nested underneath as sub-rows so the FE can
  # render the MRPEasy-style hierarchy.
  defp mo_parts_breakdown(%Backend.Production.ManufacturingOrder{
         bom: %Backend.Production.BOM{} = bom,
         quantity: mo_qty,
         company_id: company_id
       } = mo) do
    # Overlay-active behaviour matches ``book_all_for_mo_txn``:
    #
    #   1. Default packaging-typed BOM lines are hidden — the combo
    #      takes their place.
    #   2. The subset of combo items that route to THIS MO is
    #      appended below as synthetic parts so the operator picks /
    #      pre-checks / books them through the same UX as any real
    #      BOM line.
    #
    # Per-item stage routing (NPD Option A): each combo item may
    # carry a ``psp_stage_uuid`` pointing at the stage MO that
    # should book it. ``overlay_items_for_mo`` filters to items
    # matching THIS MO's produced item — bottle on the packaging
    # stage MO, lid on the finished stage root, etc. — so the parts
    # table under each MO shows exactly what that MO is on the hook
    # for, not the whole overlay list stacked under the root.
    #
    # Root MO with the JSONB carrying only items whose stage matches
    # a descendant → overlay is active tree-wide but the root itself
    # gets zero synthetic rows (correct — the operator sees the
    # semi-input row, and the bottle appears under the child MO).
    overlay_active? = Backend.Production.packaging_overlay_active?(mo)
    overlay_items = Backend.Production.overlay_items_for_mo(mo)

    overrides =
      case Map.get(mo, :bom_overrides) do
        %Ecto.Association.NotLoaded{} -> Backend.Production.list_mo_bom_overrides(mo.id)
        list when is_list(list) -> list
        _ -> []
      end

    master_lines =
      case bom.lines do
        %Ecto.Association.NotLoaded{} ->
          Backend.Repo.preload(bom,
            lines: [:unit_of_measurement, part: :stock_uom]
          ).lines

        list when is_list(list) ->
          list
      end
      |> Enum.sort_by(& &1.sort_order)
      |> then(fn ls ->
        if overlay_active?, do: Enum.reject(ls, &packaging_bom_line?/1), else: ls
      end)

    # Layer per-MO overrides on top: qty edits swap the line's :qty
    # in place; removes drop the master line entirely (surfaced
    # separately as ghost rows below); adds land as synthetic
    # lines with a negative id.
    lines = Backend.Production.effective_bom_lines(master_lines, overrides)

    bookings =
      case Map.get(mo, :bookings) do
        %Ecto.Association.NotLoaded{} ->
          Backend.Repo.preload(mo,
            bookings: [:item, :storage_cell, stock_lot: [placements: :storage_cell]]
          ).bookings

        list when is_list(list) ->
          list

        _ ->
          []
      end

    bookings_by_item = Enum.group_by(bookings, & &1.item_id)

    # Pickup photos per booked lot — the picker snaps a shot of each
    # sealed container at the shelf during confirm-transfer, and we
    # surface that image next to the booking on the run page so the
    # production team can recognise the box before they start.
    last_photo_urls =
      bookings
      |> Enum.map(& &1.stock_lot_id)
      |> Enum.reject(&is_nil/1)
      |> Enum.uniq()
      |> then(&Backend.Stock.last_photo_url_by_lot_ids(company_id, &1))

    # Open children producing each item — used to compute the
    # "Sub-MO running" status. Keyed by item_id of the child's output.
    children =
      case Map.get(mo, :children) do
        %Ecto.Association.NotLoaded{} -> []
        list when is_list(list) -> list
        _ -> []
      end

    children_by_item =
      children
      |> Enum.filter(&(&1.status not in ["completed", "cancelled"]))
      |> Enum.group_by(& &1.item_id)

    part_ids = lines |> Enum.map(& &1.part_id) |> Enum.reject(&is_nil/1)
    costs = Backend.Production.average_unit_costs(company_id, part_ids)

    # Items with at least one open PO line — used to surface
    # "Expecting" instead of "Not booked" on shortage rows. An open PO
    # line is one whose parent PO is sent to the supplier
    # (`ordered`) or has only partially landed (`partially_received`)
    # AND still has un-received qty. This lets the operator see at a
    # glance "no PO yet" vs "PO out, waiting on supplier."
    items_with_open_po =
      items_with_open_purchase_orders(company_id, part_ids)

    {parts, total} =
      Enum.reduce(lines, {[], Decimal.new("0")}, fn line, {acc_parts, acc_total} ->
        unit_cost = Map.get(costs, line.part_id)

        required_qty =
          cond do
            line.is_fixed -> line.qty
            is_nil(line.qty) -> nil
            is_nil(mo_qty) -> nil
            true -> Decimal.mult(line.qty, mo_qty)
          end
          |> Backend.Production.normalise_count_qty(line)
          # Bookings, shortages and the qty input on the FE all live at
          # Decimal(20,10) storage precision. Round the pure-math
          # BOM.qty x MO.quantity result to the same precision so the
          # FE ``required - booked`` subtraction can't leak a
          # picoscale (2.5e-11) residue that lights the row up as
          # under-booked and pops an add-booking modal for a qty the
          # operator can't actually book.
          |> normalise_qty_to_storage_precision()

        line_total =
          cond do
            is_nil(required_qty) -> nil
            is_nil(unit_cost) -> nil
            true -> Decimal.mult(required_qty, unit_cost)
          end

        # Once an MO is `completed`, requested+consumed bookings stop
        # signalling "shortage" — the run is over, what was actually
        # used is the truth. Include consumed-status bookings in the
        # rollup so the row reads as fully satisfied even after the
        # closeout stamped them.
        line_bookings =
          case mo.status do
            "completed" ->
              Map.get(bookings_by_item, line.part_id, [])
              |> Enum.filter(&(&1.status in ["requested", "consumed"]))

            _ ->
              Map.get(bookings_by_item, line.part_id, [])
              |> Enum.filter(&(&1.status == "requested"))
          end

        booked_sum =
          Enum.reduce(line_bookings, Decimal.new(0), fn b, acc ->
            Decimal.add(acc, b.quantity || Decimal.new(0))
          end)

        consumed_sum =
          Enum.reduce(line_bookings, Decimal.new(0), fn b, acc ->
            Decimal.add(acc, b.consumed_quantity || Decimal.new(0))
          end)

        # Pending contributions from open child MOs producing this
        # part. Each contribution shows up as its own sub-row on the
        # FE labelled "Awaiting production from MO-XXX".
        pending_children = Map.get(children_by_item, line.part_id, [])

        pending_sum =
          Enum.reduce(pending_children, Decimal.new(0), fn c, acc ->
            Decimal.add(acc, c.quantity || Decimal.new(0))
          end)

        coverage = Decimal.add(booked_sum, pending_sum)

        has_open_po = MapSet.member?(items_with_open_po, line.part_id)

        coverage_status =
          coverage_state_for(
            mo.status,
            required_qty,
            booked_sum,
            consumed_sum,
            pending_sum,
            coverage,
            has_open_po,
            mo.purchasing_requested_at != nil
          )

        # On completed MOs there's no shortage concept — the run is
        # over and nothing else can be procured for it. Surface nil
        # so the red "Not booked" sub-row stops rendering.
        unbooked_qty =
          cond do
            mo.status == "completed" ->
              nil

            is_nil(required_qty) ->
              nil

            true ->
              gap = Decimal.sub(required_qty, coverage)
              if Decimal.compare(gap, Decimal.new("0")) == :gt, do: gap, else: nil
          end

        part_row = %{
          id: line.id,
          uuid: line.uuid,
          sort_order: line.sort_order,
          is_fixed: line.is_fixed,
          part: maybe_item_summary(line.part),
          unit_of_measurement:
            maybe_unit_compact(line.unit_of_measurement) ||
              maybe_unit_compact(line.part && line.part.stock_uom),
          line_qty: decimal_to_string(line.qty),
          required_qty: decimal_to_string(required_qty),
          unit_cost: decimal_to_string(unit_cost),
          total_cost: decimal_to_string(line_total),
          booked_qty: decimal_to_string(booked_sum),
          consumed_qty: decimal_to_string(consumed_sum),
          pending_from_sub_mos_qty: decimal_to_string(pending_sum),
          unbooked_qty: decimal_to_string(unbooked_qty),
          coverage_status: coverage_status,
          bookings: Enum.map(line_bookings, &mo_booking(&1, last_photo_urls)),
          pending_from_sub_mos: Enum.map(pending_children, &mo_pending_sub_mo_row/1),
          # Per-MO override state. `nil` when the row is the master
          # BOM row untouched. Populated when the planner has added
          # this line or tweaked its qty for this MO only.
          override: mo_override_row(Map.get(line, :__override__)),
          # Legacy single-row columns — kept null since multiple
          # bookings can stack against the same line.
          lot: nil,
          status: nil,
          storage_location: nil,
          available_from: nil
        }

        new_total = if line_total, do: Decimal.add(acc_total, line_total), else: acc_total
        {[part_row | acc_parts], new_total}
      end)

    parts = Enum.reverse(parts)

    overlay_parts =
      if overlay_active? do
        build_overlay_parts(
          overlay_items,
          mo,
          mo_qty,
          bookings_by_item,
          last_photo_urls,
          company_id
        )
      else
        []
      end

    overlay_total =
      Enum.reduce(overlay_parts, Decimal.new("0"), fn part, acc ->
        case Map.get(part, :total_cost) do
          nil -> acc
          str -> Decimal.add(acc, Decimal.new(str))
        end
      end)

    combined_total = Decimal.add(total, overlay_total)

    materials_total =
      if Decimal.equal?(combined_total, Decimal.new("0")),
        do: nil,
        else: combined_total

    # Ghost rows for removed lines — dimmed on the parts table with a
    # "Restore" quick action so the planner can put a mistake back.
    # Zero coverage, zero required — they exist purely for
    # transparency in the audit trail + one-click revert.
    removed_parts =
      overrides
      |> Backend.Production.removed_bom_overrides()
      |> Enum.map(&removed_override_ghost_row/1)

    {parts ++ overlay_parts ++ removed_parts, materials_total}
  end

  defp mo_parts_breakdown(_), do: {[], nil}

  # Renders an override row for the parts payload. `nil` when the
  # line has no override attached (i.e. an untouched master row).
  defp mo_override_row(nil), do: nil

  defp mo_override_row(%Backend.Production.MOBOMOverride{} = ov) do
    %{
      uuid: ov.uuid,
      action: ov.action,
      from_qty: ov.from_qty && Decimal.to_string(ov.from_qty),
      to_qty: ov.to_qty && Decimal.to_string(ov.to_qty),
      reason: ov.reason,
      created_by: actor_light(ov.created_by),
      created_at: ov.inserted_at
    }
  end

  defp removed_override_ghost_row(%Backend.Production.MOBOMOverride{} = ov) do
    line = ov.bom_line

    part =
      cond do
        line && not is_nil(line.part) -> line.part
        true -> nil
      end

    %{
      id: -ov.id,
      uuid: ov.uuid,
      sort_order: 20_000,
      is_fixed: (line && line.is_fixed) || false,
      part: maybe_item_summary(part),
      unit_of_measurement:
        maybe_unit_compact(line && line.unit_of_measurement) ||
          maybe_unit_compact(part && part.stock_uom),
      line_qty: line && decimal_to_string(line.qty),
      required_qty: "0",
      unit_cost: nil,
      total_cost: nil,
      booked_qty: "0",
      consumed_qty: "0",
      pending_from_sub_mos_qty: "0",
      unbooked_qty: nil,
      coverage_status: "removed",
      bookings: [],
      pending_from_sub_mos: [],
      override: mo_override_row(ov),
      lot: nil,
      status: nil,
      storage_location: nil,
      available_from: nil
    }
  end

  defp actor_light(nil), do: nil
  defp actor_light(%Ecto.Association.NotLoaded{}), do: nil

  defp actor_light(%Backend.Accounts.User{} = u) do
    %{id: u.id, uuid: u.uuid, name: u.name, email: u.email}
  end

  defp actor_light(_), do: nil

  # Overlay counterpart of the BOM parts loop. Same row shape as the
  # real BOM lines so ``mo-parts-table.tsx`` renders them side-by-side
  # without a special branch: booking sub-rows expand the same way,
  # coverage badges compute from the same helper, and the pick /
  # pre-check / book buttons wire straight through.
  #
  # ``id`` is a negative synthetic integer keyed off the overlay
  # position so React keys stay unique alongside real ``bom_line.id``
  # (always positive). ``source: "packaging_combo"`` marks the row so
  # a future FE badge can distinguish combo-derived parts from BOM
  # ones at a glance.
  defp build_overlay_parts(
         overlay_items,
         mo,
         mo_qty,
         bookings_by_item,
         last_photo_urls,
         company_id
       ) do
    item_ids =
      overlay_items
      |> Enum.map(&overlay_item_id/1)
      |> Enum.reject(&is_nil/1)
      |> Enum.uniq()

    items_by_id =
      if item_ids == [] do
        %{}
      else
        import Ecto.Query, only: [from: 2]

        Backend.Repo.all(
          from i in Backend.Items.Item,
            where: i.company_id == ^company_id and i.id in ^item_ids,
            preload: :stock_uom
        )
        |> Map.new(fn i -> {i.id, i} end)
      end

    costs = Backend.Production.average_unit_costs(company_id, item_ids)
    open_po_items = items_with_open_purchase_orders(company_id, item_ids)

    overlay_items
    |> Enum.with_index()
    |> Enum.flat_map(fn {row, idx} ->
      item_id = overlay_item_id(row)
      item = item_id && Map.get(items_by_id, item_id)

      case item do
        %Backend.Items.Item{} = item ->
          [
            build_overlay_part_row(
              row,
              idx,
              item,
              mo,
              mo_qty,
              bookings_by_item,
              last_photo_urls,
              costs,
              open_po_items
            )
          ]

        _ ->
          []
      end
    end)
  end

  defp build_overlay_part_row(
         row,
         idx,
         %Backend.Items.Item{} = item,
         mo,
         _mo_qty,
         bookings_by_item,
         last_photo_urls,
         costs,
         open_po_items
       ) do
    # Overlay ``quantity`` is the ABSOLUTE TOTAL — NPD already
    # multiplied ``per_pack × total_packs`` (with ceil rounding for
    # count items) — so ``required_qty`` reads straight off the row.
    # Do not scale by mo.quantity again; the old per-unit contract
    # forced repeating-decimal drift for count items.
    required_qty =
      overlay_decimal(row, "quantity", Decimal.new("1"))
      |> normalise_qty_to_storage_precision()

    per_unit_qty = required_qty

    unit_cost = Map.get(costs, item.id)

    line_total =
      cond do
        is_nil(required_qty) -> nil
        is_nil(unit_cost) -> nil
        true -> Decimal.mult(required_qty, unit_cost)
      end

    line_bookings =
      case mo.status do
        "completed" ->
          Map.get(bookings_by_item, item.id, [])
          |> Enum.filter(&(&1.status in ["requested", "consumed"]))

        _ ->
          Map.get(bookings_by_item, item.id, [])
          |> Enum.filter(&(&1.status == "requested"))
      end

    booked_sum =
      Enum.reduce(line_bookings, Decimal.new(0), fn b, acc ->
        Decimal.add(acc, b.quantity || Decimal.new(0))
      end)

    consumed_sum =
      Enum.reduce(line_bookings, Decimal.new(0), fn b, acc ->
        Decimal.add(acc, b.consumed_quantity || Decimal.new(0))
      end)

    coverage = booked_sum
    has_open_po = MapSet.member?(open_po_items, item.id)

    coverage_status =
      coverage_state_for(
        mo.status,
        required_qty,
        booked_sum,
        consumed_sum,
        Decimal.new(0),
        coverage,
        has_open_po,
        mo.purchasing_requested_at != nil
      )

    unbooked_qty =
      cond do
        mo.status == "completed" ->
          nil

        is_nil(required_qty) ->
          nil

        true ->
          gap = Decimal.sub(required_qty, coverage)
          if Decimal.compare(gap, Decimal.new("0")) == :gt, do: gap, else: nil
      end

    %{
      # Negative synthetic id so React keys stay unique against real
      # bom_line ids (always positive). ``uuid`` is a stable string
      # the FE can use when it needs a URL-safe handle.
      id: -1 - idx,
      uuid: "packaging_combo:#{item.id}",
      sort_order: 9_000 + idx,
      is_fixed: false,
      source: "packaging_combo",
      part: maybe_item_summary(item),
      unit_of_measurement: maybe_unit_compact(item.stock_uom),
      line_qty: decimal_to_string(per_unit_qty),
      required_qty: decimal_to_string(required_qty),
      unit_cost: decimal_to_string(unit_cost),
      total_cost: decimal_to_string(line_total),
      booked_qty: decimal_to_string(booked_sum),
      consumed_qty: decimal_to_string(consumed_sum),
      pending_from_sub_mos_qty: decimal_to_string(Decimal.new(0)),
      unbooked_qty: decimal_to_string(unbooked_qty),
      coverage_status: coverage_status,
      bookings: Enum.map(line_bookings, &mo_booking(&1, last_photo_urls)),
      pending_from_sub_mos: [],
      lot: nil,
      status: nil,
      storage_location: nil,
      available_from: nil
    }
  end

  defp overlay_item_id(row) do
    case Map.get(row, "item_id") do
      i when is_integer(i) -> i
      s when is_binary(s) ->
        case Integer.parse(s) do
          {i, ""} -> i
          _ -> nil
        end

      _ -> nil
    end
  end

  defp overlay_decimal(row, key, default) do
    case Map.get(row, key) do
      %Decimal{} = d -> d
      n when is_integer(n) -> Decimal.new(n)
      n when is_float(n) -> Decimal.from_float(n)
      s when is_binary(s) ->
        case Decimal.parse(s) do
          {d, ""} -> d
          _ -> default
        end

      _ -> default
    end
  end

  defp packaging_bom_line?(%{part: %Backend.Items.Item{item_type: "packaging"}}),
    do: true

  defp packaging_bom_line?(_), do: false

  # Derive the master-row badge state from booked + sub-MO pending vs
  # required. `nil` required (no qty on the line) leaves it `unknown`.
  # For completed MOs the badge tells the post-run truth: how much
  # was actually consumed, not what was booked at scheduling time.
  defp coverage_state_for(_status, nil, _booked, _consumed, _pending, _coverage, _has_open_po, _requested),
    do: "unknown"

  defp coverage_state_for(
         "completed",
         %Decimal{} = required,
         _booked,
         consumed,
         _pending,
         _coverage,
         _has_open_po,
         _requested
       ) do
    cond do
      Decimal.compare(consumed, required) in [:eq, :gt] -> "consumed"
      Decimal.compare(consumed, Decimal.new("0")) == :gt -> "consumed_short"
      true -> "consumed_none"
    end
  end

  defp coverage_state_for(
         _status,
         %Decimal{} = required,
         booked,
         _consumed,
         pending,
         coverage,
         has_open_po,
         purchasing_requested
       ) do
    cond do
      Decimal.compare(coverage, required) in [:eq, :gt] ->
        # Fully covered. Pick the dominant source so the badge tells
        # the operator whether to wait on a sub-MO or just go.
        cond do
          Decimal.compare(pending, Decimal.new("0")) == :gt and
              Decimal.compare(booked, pending) == :lt ->
            "sub_mo_in_progress"

          true ->
            "booked"
        end

      Decimal.compare(coverage, Decimal.new("0")) == :gt ->
        "partial"

      has_open_po ->
        # No booking yet but a PO is out — operator should wait for
        # the delivery + Goods-In Inspection rather than chasing
        # procurement again.
        "expecting"

      purchasing_requested ->
        # Planner has hit Request purchases. Procurement is on the
        # hook — no PO yet, but the shortage is in their queue.
        # Sky-blue badge instead of red "Not booked" so the planner
        # knows the gap has been handed off.
        "awaiting_po"

      true ->
        "not_booked"
    end
  end

  # Items with at least one open PO line that still has un-received
  # qty. PO status filter narrows to lines that are physically out at
  # the supplier (`ordered`) or partially landed
  # (`partially_received`). `qty_received < qty_ordered` ensures
  # fully-landed lines don't count.
  defp items_with_open_purchase_orders(_company_id, []), do: MapSet.new()

  defp items_with_open_purchase_orders(company_id, item_ids) do
    import Ecto.Query

    from(l in Backend.Purchasing.PurchaseOrderLine,
      join: po in Backend.Purchasing.PurchaseOrder,
      on: po.id == l.purchase_order_id,
      where:
        l.company_id == ^company_id and
          l.item_id in ^item_ids and
          po.status in ["ordered", "partially_received"] and
          l.qty_received < l.qty_ordered,
      select: l.item_id,
      distinct: true
    )
    |> Backend.Repo.all()
    |> MapSet.new()
  end

  defp mo_pending_sub_mo_row(%Backend.Production.ManufacturingOrder{} = child) do
    %{
      id: child.id,
      uuid: child.uuid,
      code: render_code(child, "manufacturing_order"),
      status: child.status,
      quantity: decimal_to_string(child.quantity),
      item: maybe_item_summary(child.item)
    }
  end

  @doc """
  Full booking row payload — the FE renders one of these per
  sub-row under each part master row.
  """
  def mo_booking(booking, last_photo_urls \\ %{})

  def mo_booking(%Backend.Production.ManufacturingOrderBooking{} = b, last_photo_urls)
      when is_map(last_photo_urls) do
    %{
      id: b.id,
      uuid: b.uuid,
      quantity: decimal_to_string(b.quantity),
      consumed_quantity: decimal_to_string(b.consumed_quantity),
      status: b.status,
      note: b.note,
      item_id: b.item_id,
      item: maybe_item_summary(b.item),
      stock_lot_id: b.stock_lot_id,
      stock_lot: mo_booking_lot_summary(b.stock_lot, last_photo_urls),
      # Placeholder booking link — set when the booking reserves qty
      # against an open PO line instead of a real lot. Mutually
      # exclusive with stock_lot_id. The FE labels these rows
      # "Expecting from POxxxxx" so the planner knows the lot is in
      # flight (not yet on the shelf).
      purchase_order_line_id: b.purchase_order_line_id,
      purchase_order_line: mo_booking_po_line_summary(b.purchase_order_line),
      storage_cell_id: b.storage_cell_id,
      storage_location: mo_booking_cell_summary(b.storage_cell),
      manufacturing_order_id: b.manufacturing_order_id,
      # Pickup state — picked_at IS NOT NULL means the lot is on the
      # picker's trolley (logically still at storage_cell until the
      # final confirm-transfer emits the actual move movement).
      picked_at: b.picked_at,
      picked_by: actor(b, :picked_by),
      # Pre-production receipt sign-off. The production operator
      # weighs / counts the lot at the production-feed cell and
      # records any quality remarks; nothing about consumption yet
      # (that's a separate step on MO start).
      received_at: b.received_at,
      received_by: actor(b, :received_by),
      received_qty: decimal_to_string(b.received_qty),
      received_notes: b.received_notes,
      # Production closeout — stamped when the operator hits Finish
      # and records how much was actually used. Surfaces alongside the
      # picker + receiver stamps on the parts-table "Sign-offs" column
      # so the room sees full traceability for each booking.
      consumed_at: b.consumed_at,
      consumed_by: actor(b, :consumed_by),
      inserted_at: b.inserted_at,
      updated_at: b.updated_at
    }
  end

  def mo_booking(_, _), do: nil

  @doc """
  One row of the warehouse picker's queue. Wraps the MO with the
  picker-relevant projections (visibility window, pickup_by time,
  current head-of-picker if started). The full MO payload is heavy;
  this stays slim so the queue list loads fast on mobile.
  """
  def pickup_queue_entry(%{
        mo: %Backend.Production.ManufacturingOrder{} = mo,
        pickup_by: pickup_by,
        visible_from: visible_from,
        window_hours: window_hours
      }) do
    %{
      mo: manufacturing_order_summary(mo),
      visible_from: visible_from,
      pickup_by: pickup_by,
      window_hours: window_hours,
      pickup_started_at: mo.pickup_started_at,
      pickup_started_by: actor(mo, :pickup_started_by),
      released_to_warehouse_at: mo.released_to_warehouse_at,
      released_to_warehouse_by_id: mo.released_to_warehouse_by_id
    }
  end

  def pickup_queue_entry(_), do: nil

  @doc """
  One row of the production-operator's preflight queue. Slim shape:
  MO header + planned_start (so the operator sees how soon production
  is supposed to fire) + pickup_completed snapshot.
  """
  def preflight_queue_entry(%{
        mo: %Backend.Production.ManufacturingOrder{} = mo,
        planned_start: planned_start
      }) do
    %{
      mo: manufacturing_order_summary(mo),
      planned_start: planned_start,
      pickup_completed_at: mo.pickup_completed_at,
      pickup_completed_by: actor(mo, :pickup_completed_by)
    }
  end

  def preflight_queue_entry(_), do: nil

  @doc """
  One row of the production-run queue. Slim shape so the desk operator
  can scan dozens of MOs at a glance; per-MO detail is fetched on
  click.
  """
  def production_run_entry(%Backend.Production.ManufacturingOrder{} = mo) do
    {start_at, finish_at} = mo_planned_bounds(mo)

    %{
      mo: manufacturing_order_summary(mo),
      planned_start: start_at,
      planned_finish: finish_at,
      actual_start: mo.actual_start,
      actual_finish: mo.actual_finish,
      quantity_produced: decimal_to_string(mo.quantity_produced),
      pickup_completed_at: mo.pickup_completed_at,
      pickup_completed_by: actor(mo, :pickup_completed_by)
    }
  end

  def production_run_entry(_), do: nil

  @doc """
  One row of the Output QC queue. Surfaces a manufactured lot still
  in `received` status + its source MO context so the QC operator
  can verify which production run produced it.
  """
  def output_qc_entry(%{lot: %Backend.Stock.Lot{} = lot, mo: mo} = entry) do
    resolved_spec_item = Map.get(entry, :resolved_spec_item)
    resolved_spec_source = Map.get(entry, :resolved_spec_source, :none)
    cell =
      case lot.placements do
        [%{storage_cell: %Backend.Warehouses.StorageCell{} = c} | _] -> c
        _ -> nil
      end

    %{
      lot: %{
        id: lot.id,
        uuid: lot.uuid,
        code: render_code(lot, "stock_lot"),
        qty_received: decimal_to_string(lot.qty_received),
        status: lot.status,
        package_length_mm: lot.package_length_mm,
        package_width_mm: lot.package_width_mm,
        package_height_mm: lot.package_height_mm,
        package_weight_kg: decimal_to_string(lot.package_weight_kg),
        units_per_package: decimal_to_string(lot.units_per_package),
        stack_factor: lot.stack_factor,
        received_at: lot.received_at,
        item: maybe_item_summary(lot.item),
        uom:
          lot.unit_of_measurement &&
            %{
              id: lot.unit_of_measurement.id,
              symbol: lot.unit_of_measurement.symbol,
              name: lot.unit_of_measurement.name
            },
        production_cell:
          cell &&
            %{
              id: cell.id,
              uuid: cell.uuid,
              name: cell.name,
              storage_location:
                cell.storage_location &&
                  %{
                    code: cell.storage_location.code,
                    name: cell.storage_location.name,
                    floor:
                      cell.storage_location.floor &&
                        %{
                          name: cell.storage_location.floor.name,
                          warehouse:
                            cell.storage_location.floor.warehouse &&
                              %{name: cell.storage_location.floor.warehouse.name}
                        }
                  }
            }
      },
      mo:
        mo &&
          %{
            id: mo.id,
            uuid: mo.uuid,
            code: render_code(mo, "manufacturing_order"),
            item: maybe_item_summary(mo.item),
            quantity: decimal_to_string(mo.quantity),
            quantity_produced: decimal_to_string(mo.quantity_produced),
            actual_finish: mo.actual_finish,
            project_type: mo.project_type,
            # NPD back-refs let the FE build a deep-link into NPD's
            # QC page (formulation-scoped) with the trial batch as
            # dedupe key — clicking opens the existing validation for
            # this batch or creates a new one.
            npd_formulation_uuid: mo.npd_formulation_uuid,
            npd_trial_batch_uuid: mo.npd_trial_batch_uuid,
            # NPD project flavour walked from the linked CO. Nil
            # when the MO has no CO line. Exposed for observability
            # — the load-bearing gate for ``NpdValidationCard`` uses
            # ``is_customer_sample_fulfilment`` below instead.
            npd_project_type: npd_project_type_from_mo(mo),
            # True when the linked CO carries ``sample_kind = true``
            # — meaning "a customer paid for a specific sample kit
            # via the /samples fulfilment queue, this MO is producing
            # THAT sample". Powers the ``NpdValidationCard`` hide
            # rule: customer-paid samples don't need per-batch
            # validation (whether Custom or RTG) because they're
            # fulfilment production of an already-validated recipe,
            # not R&D validation runs. Internal RTG validation
            # trials (scientist creating a batch to prove a new RTG
            # recipe before publishing) have NO CO link, so this is
            # false and the card correctly shows. Nil-safe: MOs
            # without a CO chain return false, falling through to
            # the show-card default.
            is_customer_sample_fulfilment:
              customer_sample_fulfilment?(mo),
            # NPD ProductValidation snapshot pushed by the sync
            # webhook. Drives the Output QC pass button gate + the
            # status pill on the NPD validation card.
            npd_validation_uuid: mo.npd_validation_uuid,
            npd_validation_status: mo.npd_validation_status,
            npd_validation_synced_at: mo.npd_validation_synced_at,
            npd_validation_failure_reason: mo.npd_validation_failure_reason,
            workstation_groups: mo_workstation_groups(mo),
            pickup_completed_by: actor(mo, :pickup_completed_by)
          },
      finished_product_spec:
        finished_product_spec_payload(resolved_spec_item || lot.item),
      finished_product_spec_source:
        case resolved_spec_source do
          :own ->
            %{kind: "own"}

          {:parent, %Backend.Production.ManufacturingOrder{} = parent_mo} ->
            %{
              kind: "parent",
              mo_uuid: parent_mo.uuid,
              item_name:
                case Map.get(parent_mo, :item) do
                  %Backend.Items.Item{name: n} -> n
                  _ -> nil
                end
            }

          _ ->
            %{kind: "none"}
        end,
      item_type: lot.item && lot.item.item_type
    }
  end

  defp mo_workstation_groups(%Backend.Production.ManufacturingOrder{steps: steps})
       when is_list(steps) do
    steps
    |> Enum.map(fn s ->
      case Map.get(s, :workstation_group) do
        %Backend.Production.WorkstationGroup{uuid: uuid, name: name} ->
          %{uuid: uuid, name: name}

        _ ->
          nil
      end
    end)
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq_by(& &1.uuid)
  end

  defp mo_workstation_groups(_), do: []

  # Walk MO → CO line → CO to read the NPD project flavour ("custom"
  # or "ready_to_go"). Nil-safe at each hop: MOs without a linked CO
  # line (legacy trial-batch integrations, standalone PSP MOs) or
  # unloaded preloads collapse to nil so the payload never crashes.
  defp npd_project_type_from_mo(mo) do
    with %{customer_order_line: %{customer_order: %{npd_project_type: pt}}} <-
           mo do
      pt
    else
      _ -> nil
    end
  end

  # True when the MO's linked CO is a sample-fulfilment CO (spawned
  # by NPD's ``sync_sample_customer_order_to_psp`` from the /samples
  # fulfilment queue — meaning a customer paid for a specific
  # sample kit and THIS MO is producing that sample). False for MOs
  # with no linked CO (internal validation trials — scientist
  # created the batch to prove a recipe) or MOs linked to a
  # commercial CO (``sample_kind = false``).
  #
  # ``kind`` on the trial batch (trial vs sample) is NOT the right
  # signal — scientists commonly pick ``trial`` on a customer-paid
  # sample too (bench-scale run of a customer's sample kit). The
  # CO's ``sample_kind`` flag is set once at sync time by NPD, so
  # it stays stable across kind edits and doesn't drift.
  defp customer_sample_fulfilment?(mo) do
    match?(
      %{customer_order_line: %{customer_order: %{sample_kind: true}}},
      mo
    )
  end

  # Compact projection of the finished-product spec (from NPD or PSP
  # manual). Only the fields a QA operator would compare against the
  # physical lot — dosage form, appearance, disintegration, weight
  # uniformity, shelf life, storage, allergens, and any claims list.
  # Nil when the item isn't a finished product or the spec hasn't been
  # filled in yet.
  defp finished_product_spec_payload(%Backend.Items.Item{finished_product_spec: %Backend.Items.FinishedProductSpec{} = s}) do
    %{
      regulatory_category: s.regulatory_category,
      dosage_form: s.dosage_form,
      capsule_size: s.capsule_size,
      tablet_size_mm: decimal_to_string(s.tablet_size_mm),
      powder_type: s.powder_type,
      serving_size: decimal_to_string(s.serving_size),
      servings_per_pack: s.servings_per_pack,
      net_quantity: decimal_to_string(s.net_quantity),
      directions_of_use: s.directions_of_use,
      suggested_dosage: s.suggested_dosage,
      warnings_text: s.warnings_text,
      appearance: s.appearance,
      disintegration_spec: s.disintegration_spec,
      weight_uniformity_pct: decimal_to_string(s.weight_uniformity_pct),
      shelf_life_months: s.shelf_life_months,
      storage_conditions: s.storage_conditions,
      food_contact_status: s.food_contact_status,
      active_claims: s.active_claims,
      general_claims: s.general_claims,
      target_markets: s.target_markets,
      may_contain_allergens: s.may_contain_allergens,
      may_contain_justification: s.may_contain_justification
    }
  end

  defp finished_product_spec_payload(_), do: nil

  def output_qc_entry(_), do: nil

  @doc """
  One row of the production-closeout queue. Slim — just enough for
  the mobile list to render. Per-MO detail is fetched on click.
  """
  def closeout_queue_entry(%Backend.Production.ManufacturingOrder{} = mo) do
    %{
      mo: manufacturing_order_summary(mo),
      actual_finish: mo.actual_finish,
      production_cell:
        mo.production_cell &&
          %{
            id: mo.production_cell.id,
            uuid: mo.production_cell.uuid,
            name: mo.production_cell.name
          }
    }
  end

  def closeout_queue_entry(_), do: nil

  @doc """
  One produced output lot still sitting at the production-feed cell.
  Shaped like a slimmed booking row so the mobile flow can render
  them in the same list as bookings (same scan-photo-qty pattern).
  """
  def closeout_output_lot(lot, reservations \\ [])

  def closeout_output_lot(%Backend.Stock.Lot{} = lot, reservations) do
    cell =
      case lot.placements do
        [%{storage_cell: %Backend.Warehouses.StorageCell{} = c} | _] -> c
        _ -> nil
      end

    qty_on_hand =
      case lot.placements do
        list when is_list(list) ->
          Enum.reduce(list, Decimal.new(0), fn p, acc ->
            Decimal.add(acc, p.qty || Decimal.new(0))
          end)

        _ ->
          Decimal.new(0)
      end

    # Fall back to the parent item's stock_uom when the lot itself
    # has no UoM stamped — opening-balance + manual-lot rows skip
    # the dedicated UoM column and inherit from the item. Without
    # this fallback the closeout page rendered "ea" for kg lots.
    uom_source =
      lot.unit_of_measurement ||
        case lot.item do
          %Backend.Items.Item{stock_uom: %Backend.Units.UnitOfMeasurement{} = u} -> u
          _ -> nil
        end

    %{
      id: lot.id,
      uuid: lot.uuid,
      code: render_code(lot, "stock_lot"),
      qty_on_hand: decimal_to_string(qty_on_hand),
      status: lot.status,
      item: maybe_item_summary(lot.item),
      uom:
        uom_source &&
          %{
            id: uom_source.id,
            symbol: uom_source.symbol,
            name: uom_source.name
          },
      current_cell:
        cell &&
          %{
            id: cell.id,
            uuid: cell.uuid,
            name: cell.name
          },
      # Live downstream reservations — populated by the closeout
      # controller so the FE can render the "reserved for MO-X" chip
      # and hide the scan-cell / photo requirement (a reserved lot
      # stays in place at the production feed cell for the downstream
      # picker to grab). Empty list == fresh lot, no downstream owner.
      reserved_by:
        Enum.map(reservations, fn r ->
          %{
            mo_uuid: r.mo_uuid,
            # `mo_code` is rendered from the numbering sequence per
            # tenant — MO has no `code` column. See
            # `Backend.Production.output_lot_reservations_for_ids/1`.
            mo_code: render_code(%{id: r.mo_id}, "manufacturing_order"),
            qty: to_string(r.qty)
          }
        end)
    }
  end

  def closeout_output_lot(_, _), do: nil

  @doc """
  Production-dispatch cell row for the closeout flow's
  destination picker. Includes the breadcrumb so the operator can
  identify which dispatch lane on the floor they're sending the
  hand-off to.
  """
  def dispatch_cell(%Backend.Warehouses.StorageCell{} = c) do
    loc = c.storage_location
    floor = loc && Ecto.assoc_loaded?(loc.floor) && loc.floor
    warehouse = floor && Ecto.assoc_loaded?(floor.warehouse) && floor.warehouse

    %{
      id: c.id,
      uuid: c.uuid,
      name: c.name,
      ordinal: c.ordinal,
      code:
        if(loc,
          do: loc.code || loc.name || c.name || "Cell ##{c.id}",
          else: c.name || "Cell ##{c.id}"
        ),
      location:
        loc &&
          %{
            id: loc.id,
            uuid: loc.uuid,
            name: loc.name,
            code: loc.code,
            floor:
              floor &&
                %{
                  id: floor.id,
                  uuid: floor.uuid,
                  name: floor.name,
                  warehouse:
                    warehouse &&
                      %{id: warehouse.id, uuid: warehouse.uuid, name: warehouse.name}
                }
          }
    }
  end

  def dispatch_cell(_), do: nil

  # ----- Warehouse return pickup (Phase C) ----------------------

  @doc """
  Queue row for the warehouse-side return pickup tab. Mirrors
  `closeout_queue_entry/1` but framed around the lot count waiting
  in dispatch instead of the closeout state.
  """
  def return_pickup_queue_entry(
        %Backend.Production.ManufacturingOrder{} = mo,
        lot_count
      )
      when is_integer(lot_count) do
    %{
      mo: manufacturing_order_summary(mo),
      actual_finish: mo.actual_finish,
      lots_at_dispatch: lot_count,
      production_cell:
        mo.production_cell &&
          %{
            id: mo.production_cell.id,
            uuid: mo.production_cell.uuid,
            name: mo.production_cell.name
          }
    }
  end

  def return_pickup_queue_entry(_, _), do: nil

  @doc """
  One lot sitting at a production-side dispatch cell, ready for the
  warehouse worker to scan onto their trolley. Only the dispatch
  placement is surfaced — the lot may also live at its original
  warehouse rack (e.g. partial-consume remainder), but that portion
  isn't relevant to the return pickup.
  """
  def return_pickup_lot(lot, last_photo_urls \\ %{})

  def return_pickup_lot(%Backend.Stock.Lot{} = lot, last_photo_urls)
      when is_map(last_photo_urls) do
    placement = first_dispatch_placement(lot)

    %{
      id: lot.id,
      uuid: lot.uuid,
      code: render_code(lot, "stock_lot"),
      status: lot.status,
      qty_on_hand:
        case placement do
          nil -> "0"
          p -> decimal_to_string(p.qty)
        end,
      item: maybe_item_summary(lot.item),
      uom:
        lot.unit_of_measurement &&
          %{
            id: lot.unit_of_measurement.id,
            symbol: lot.unit_of_measurement.symbol,
            name: lot.unit_of_measurement.name
          },
      source_kind: lot.source_kind,
      source_ref: lot.source_ref,
      # Last photo a worker took while moving this lot — shown next
      # to the floor plan on the pickup screen so the operator
      # recognises the physical box at the shelf instead of just a
      # name on a label.
      last_photo_url: Map.get(last_photo_urls, lot.id),
      dispatch_cell:
        case placement do
          nil -> nil
          p -> dispatch_cell(p.storage_cell)
        end
    }
  end

  def return_pickup_lot(_, _), do: nil

  @doc """
  Trolley row — warehouse worker currently holding the lot in flight
  between the dispatch cell and the warehouse rack.
  """
  def return_pick_row(pick, last_photo_urls \\ %{})

  def return_pick_row(%Backend.Warehouses.ReturnPick{} = pick, last_photo_urls)
      when is_map(last_photo_urls) do
    %{
      id: pick.id,
      uuid: pick.uuid,
      qty: decimal_to_string(pick.qty),
      picked_at: pick.picked_at,
      picked_photo_url: pick.picked_photo_url,
      placed_at: pick.placed_at,
      placed_photo_url: pick.placed_photo_url,
      picked_by:
        case pick.picked_by do
          %Backend.Accounts.User{} = u ->
            %{id: u.id, uuid: u.uuid, name: u.name, email: u.email}

          _ ->
            nil
        end,
      stock_lot:
        case pick.stock_lot do
          %Backend.Stock.Lot{} = lot ->
            %{
              id: lot.id,
              uuid: lot.uuid,
              code: render_code(lot, "stock_lot"),
              status: lot.status,
              # Most-recent placement photo for this lot — falls back
              # to the picker's own snap if they uploaded one when
              # claiming the trolley row.
              last_photo_url:
                Map.get(last_photo_urls, lot.id) || pick.picked_photo_url,
              item: maybe_item_summary(lot.item),
              uom:
                lot.unit_of_measurement &&
                  %{
                    id: lot.unit_of_measurement.id,
                    symbol: lot.unit_of_measurement.symbol,
                    name: lot.unit_of_measurement.name
                  }
            }

          _ ->
            nil
        end,
      picked_from_cell:
        case pick.picked_from_cell do
          %Backend.Warehouses.StorageCell{} = c ->
            %{id: c.id, uuid: c.uuid, name: c.name, purpose: c.purpose}

          _ ->
            nil
        end,
      placed_to_cell:
        case pick.placed_to_cell do
          %Backend.Warehouses.StorageCell{} = c ->
            %{id: c.id, uuid: c.uuid, name: c.name, purpose: c.purpose}

          _ ->
            nil
        end
    }
  end

  def return_pick_row(_, _), do: nil

  @doc """
  Recommendation row shaped for the mobile place-step. Mirrors the
  payload `StockLotController.move_recommendations` builds inline —
  extracted here so the return-pickup controller can reuse it
  verbatim.
  """
  def move_recommendation(%{row: r, score: score, base_score: base_score}) do
    %{
      score: score,
      reason: move_recommendation_reason(base_score),
      fit: %{
        free_pct: r.fit.free_pct,
        percent_used: r.fit.percent_used,
        current_percent_used: Map.get(r.fit, :current_percent_used, 0),
        projected_percent_used:
          Map.get(r.fit, :projected_percent_used, r.fit.percent_used)
      },
      cell: %{
        id: r.cell.id,
        uuid: r.cell.uuid,
        name: r.cell.name,
        code:
          if(r.cell.system_kind,
            do: nil,
            else: render_entity_code(r.cell, "storage_cell")
          ),
        ordinal: r.cell.ordinal,
        tags: r.cell.tags || [],
        storage_location: %{
          id: r.location.id,
          uuid: r.location.uuid,
          name: r.location.name,
          code: render_entity_code(r.location, "storage_location"),
          tags: r.location.tags || []
        },
        floor: %{id: r.floor.id, uuid: r.floor.uuid, name: r.floor.name},
        warehouse: %{
          id: r.warehouse.id,
          uuid: r.warehouse.uuid,
          name: r.warehouse.name
        }
      }
    }
  end

  def move_recommendation(_), do: nil

  defp move_recommendation_reason(10), do: "Same item already here"
  defp move_recommendation_reason(8), do: "Matches all storage tags"
  defp move_recommendation_reason(4), do: "Matches some storage tags"
  defp move_recommendation_reason(1), do: "Untagged item — any cell works"
  defp move_recommendation_reason(_), do: "Available"

  defp first_placement(%Backend.Stock.Lot{placements: list}) when is_list(list) do
    Enum.find(list, fn p -> Decimal.compare(p.qty || Decimal.new(0), Decimal.new(0)) == :gt end)
  end

  defp first_placement(_), do: nil

  # Return-pickup payload helper — narrows to placements whose cell
  # is a dispatch cell with qty > 0. A lot may live at multiple
  # cells (its original warehouse rack + a dispatch cell after
  # closeout's partial hand-off); the return pickup only cares about
  # the dispatch portion.
  defp first_dispatch_placement(%Backend.Stock.Lot{placements: list})
       when is_list(list) do
    # Both `dispatch` (post-consume hand-off) and `production_feed`
    # (lot walked to the line but never consumed because the MO was
    # cancelled / regressed) are return-pickup source cells — the
    # warehouse worker walks the lot back from either. Keeping just
    # the dispatch match here caused the loose-bucket payload to
    # render 0 kg + a missing source cell whenever the lot was
    # stranded at production_feed.
    # `rnd` joins the source list too — R&D closeout leaves the
    # produced lot / raw-material leftovers on the R&D shelf, and
    # ``Backend.Warehouses.ReturnPickup.list_queue`` now surfaces
    # them alongside standard production. Without `rnd` here the
    # queue rendered the row (via the ReturnPickup source-cell
    # allowlist) but the payload's placement lookup returned nil,
    # printing "0 kg" on every line.
    Enum.find(list, fn p ->
      Decimal.compare(p.qty || Decimal.new(0), Decimal.new(0)) == :gt and
        match?(
          %Backend.Warehouses.StorageCell{purpose: purpose}
          when purpose in ["dispatch", "production_feed", "rnd"],
          p.storage_cell
        )
    end)
  end

  defp first_dispatch_placement(_), do: nil

  # Production-feed cell breadcrumb — fed into the run detail screen
  # so the floor operator sees the highlighted rack on the floor plan
  # without an extra fetch. Mirrors `mo_booking_cell_summary`.
  defp mo_production_cell_payload(%Backend.Warehouses.StorageCell{} = c) do
    base = %{
      id: c.id,
      uuid: c.uuid,
      name: c.name,
      purpose: c.purpose,
      ordinal: c.ordinal,
      system_kind: c.system_kind
    }

    case Map.get(c, :storage_location) do
      %Ecto.Association.NotLoaded{} ->
        base

      nil ->
        base

      %Backend.Warehouses.StorageLocation{} = loc ->
        floor = Ecto.assoc_loaded?(loc.floor) && loc.floor
        warehouse = floor && Ecto.assoc_loaded?(floor.warehouse) && floor.warehouse

        Map.put(base, :storage_location, %{
          id: loc.id,
          uuid: loc.uuid,
          name: loc.name,
          code: loc.code,
          floor:
            floor &&
              %{
                id: floor.id,
                uuid: floor.uuid,
                name: floor.name,
                warehouse:
                  warehouse &&
                    %{id: warehouse.id, uuid: warehouse.uuid, name: warehouse.name}
              }
        })
    end
  end

  defp mo_production_cell_payload(_), do: nil

  defp mo_booking_lot_summary(%Backend.Stock.Lot{} = lot, last_photo_urls)
       when is_map(last_photo_urls) do
    # Surface qty_on_hand alongside the lot identity so the mobile
    # closeout page can show "booked 1.0 / on hand 2.5 kg" without
    # a second fetch. Sums every placement (cross-cell totals).
    qty_on_hand =
      case lot.placements do
        list when is_list(list) ->
          Enum.reduce(list, Decimal.new(0), fn p, acc ->
            Decimal.add(acc, p.qty || Decimal.new(0))
          end)

        _ ->
          nil
      end

    %{
      id: lot.id,
      uuid: lot.uuid,
      code: render_code(lot, "stock_lot"),
      status: lot.status,
      expiry_at: lot.expiry_at,
      available_from: lot.available_from,
      qty_on_hand: decimal_to_string(qty_on_hand),
      # Last on-shelf photo for this lot — surfaced on the pickup
      # directions screen so the worker can recognise the box.
      last_photo_url: Map.get(last_photo_urls, lot.id),
      # Current packaging dims — the mobile closeout uses these to
      # pre-fill the Repackage panel so the operator sees the previous
      # values and only edits what the leftover container actually
      # measures. Nil until the lot has been through goods-in (draft
      # / reserved lots pre-dating dims).
      package_length_mm: lot.package_length_mm,
      package_width_mm: lot.package_width_mm,
      package_height_mm: lot.package_height_mm,
      package_weight_kg: decimal_to_string(lot.package_weight_kg),
      # Stack factor — max identical packs that can be safely stacked
      # vertically on this lot's container. Drives the PackBoxPreview
      # 3D visualisation on the closeout Repackage panel.
      stack_factor: lot.stack_factor
    }
  end

  defp mo_booking_lot_summary(_, _), do: nil

  # Summary for a placeholder booking — links it back to the PO line
  # it reserves against. Surfaces the parent PO code so the FE can
  # render "Expecting from PO00xxx" without an extra fetch.
  defp mo_booking_po_line_summary(%Backend.Purchasing.PurchaseOrderLine{} = line) do
    %{
      id: line.id,
      uuid: line.uuid,
      qty_ordered: decimal_to_string(line.qty_ordered),
      qty_received: decimal_to_string(line.qty_received),
      expected_delivery_date: line.expected_delivery_date,
      purchase_order:
        case Map.get(line, :purchase_order) do
          %Ecto.Association.NotLoaded{} ->
            nil

          %Backend.Purchasing.PurchaseOrder{} = po ->
            %{
              id: po.id,
              uuid: po.uuid,
              code: render_entity_code(po, "purchase_order"),
              status: po.status,
              expected_delivery_date: po.expected_delivery_date
            }

          _ ->
            nil
        end
    }
  end

  defp mo_booking_po_line_summary(_), do: nil

  defp mo_booking_cell_summary(%Backend.Warehouses.StorageCell{} = c) do
    base = %{
      id: c.id,
      uuid: c.uuid,
      name: c.name,
      purpose: c.purpose,
      ordinal: c.ordinal,
      # Receiving / quarantine / hold cells are flagged here so the
      # pickup directions UI knows the lot isn't on a real shelf yet
      # (no floor plan to render).
      system_kind: c.system_kind
    }

    # When the controller preloaded the full storage chain (e.g. the
    # warehouse-pickup detail endpoint), surface the breadcrumb so the
    # mobile flow can render the directions card + floor-plan mini.
    # Falls back gracefully when the assoc isn't loaded (other
    # consumers don't pay the cost).
    case Map.get(c, :storage_location) do
      %Ecto.Association.NotLoaded{} ->
        base

      nil ->
        base

      %Backend.Warehouses.StorageLocation{} = loc ->
        floor = if Ecto.assoc_loaded?(loc.floor), do: loc.floor
        warehouse =
          floor && Ecto.assoc_loaded?(floor.warehouse) && floor.warehouse

        # Use the rendered code (e.g. SL00022) when no manual code
        # was set on the location row. The FE leads with this in the
        # Storage column so the operator sees the rack identifier the
        # QR label carries, not just "Level 0".
        Map.put(base, :storage_location, %{
          id: loc.id,
          uuid: loc.uuid,
          name: loc.name,
          code: loc.code || render_code(loc, "storage_location"),
          floor:
            floor &&
              %{
                id: floor.id,
                uuid: floor.uuid,
                name: floor.name,
                warehouse:
                  warehouse &&
                    %{id: warehouse.id, uuid: warehouse.uuid, name: warehouse.name}
              }
        })
    end
  end

  defp mo_booking_cell_summary(_), do: nil

  @doc """
  Row for the "Add a booking" lot picker. Includes lot identity,
  cell snapshot, expiry, unit cost (so the FE can preview the total
  before booking), and the live available qty.
  """
  def mo_bookable_lot(%Backend.Stock.Lot{} = lot, available, cell) do
    %{
      id: lot.id,
      uuid: lot.uuid,
      code: render_code(lot, "stock_lot"),
      status: lot.status,
      manufactured_at: lot.manufactured_at,
      expiry_at: lot.expiry_at,
      available_from: lot.available_from,
      unit_cost: decimal_to_string(lot.unit_cost),
      currency: lot.currency,
      supplier_batch_no: lot.supplier_batch_no,
      available_qty: decimal_to_string(available),
      is_rnd: lot.is_rnd || false,
      storage_location: mo_booking_cell_summary(cell)
    }
  end

  defp mo_cost_per_unit(nil, _qty), do: nil

  defp mo_cost_per_unit(_total, qty) when is_nil(qty), do: nil

  defp mo_cost_per_unit(total, %Decimal{} = qty) do
    if Decimal.equal?(qty, Decimal.new("0")) do
      nil
    else
      total
      |> Decimal.div(qty)
      |> decimal_to_string()
    end
  end

  # Build the operations breakdown from the per-MO snapshot table.
  # Falls back to the routing template only if the snapshot hasn't
  # run yet (legacy MOs created before the snapshot migration; we
  # backfilled known cases but the fallback keeps the page useful
  # while data settles).
  defp mo_operations_breakdown(%Backend.Production.ManufacturingOrder{steps: steps})
       when is_list(steps) and steps != [] do
    steps
    |> Enum.sort_by(& &1.sort_order)
    |> Enum.map(&mo_step/1)
  end

  defp mo_operations_breakdown(%Backend.Production.ManufacturingOrder{
         routing: %Backend.Production.Routing{} = routing,
         quantity: qty
       }) do
    steps =
      case routing.steps do
        %Ecto.Association.NotLoaded{} ->
          Backend.Repo.preload(
            routing,
            steps: [:workstation_group, worker_assignments: :user]
          ).steps

        list when is_list(list) ->
          list
      end
      |> Enum.sort_by(& &1.sort_order)

    # Routing preview — used when the MO doesn't have its own
    # snapshotted steps yet. Times are nil because the MO hasn't
    # been scheduled; FE shows the routing layout without timing.
    Enum.map(steps, fn step ->
      %{
        id: step.id,
        uuid: step.uuid,
        sort_order: step.sort_order,
        operation_description: step.operation_description,
        setup_time_min: decimal_to_string(step.setup_time_min),
        cycle_time_min: decimal_to_string(step.cycle_time_min),
        fixed_cost: decimal_to_string(step.fixed_cost),
        variable_cost: decimal_to_string(step.variable_cost),
        capacity: decimal_to_string(step.capacity),
        workstation_group: workstation_group_summary(step.workstation_group),
        workstation: nil,
        workers: routing_step_workers(step),
        planned_start: nil,
        planned_finish: nil,
        planned_duration_seconds: step_duration_seconds(step, qty),
        actual_start: nil,
        actual_finish: nil,
        applied_overhead_cost: nil,
        labor_cost: nil,
        quantity: decimal_to_string(qty),
        # Sentinel: the row hasn't been snapshotted yet so the
        # pencil-edit affordance hides on the FE.
        editable: false
      }
    end)
  end

  defp mo_operations_breakdown(_), do: []

  @doc """
  Full per-MO step payload — used both on the MO detail page (one
  row per op) and on the per-step edit page show/update endpoints.
  """
  def mo_step(%Backend.Production.ManufacturingOrderStep{} = s) do
    %{
      id: s.id,
      uuid: s.uuid,
      sort_order: s.sort_order,
      operation_description: s.operation_description,
      setup_time_min: decimal_to_string(s.setup_time_min),
      cycle_time_min: decimal_to_string(s.cycle_time_min),
      fixed_cost: decimal_to_string(s.fixed_cost),
      variable_cost: decimal_to_string(s.variable_cost),
      capacity: decimal_to_string(s.capacity),
      planned_start: s.planned_start,
      planned_finish: s.planned_finish,
      planned_duration_seconds: s.planned_duration_seconds,
      planned_segments: s.planned_segments,
      actual_start: s.actual_start,
      actual_finish: s.actual_finish,
      applied_overhead_cost: decimal_to_string(s.applied_overhead_cost),
      labor_cost: decimal_to_string(s.labor_cost),
      quantity: decimal_to_string(s.quantity),
      notes: s.notes,
      workstation_group_id: s.workstation_group_id,
      workstation_group: workstation_group_summary(s.workstation_group),
      routing_step_id: s.routing_step_id,
      workers: mo_step_workers(s),
      manufacturing_order_id: s.manufacturing_order_id,
      manufacturing_order: mo_step_parent_summary(s.manufacturing_order),
      created_by: actor(s, :created_by),
      updated_by: actor(s, :updated_by),
      inserted_at: s.inserted_at,
      updated_at: s.updated_at,
      editable: true
    }
  end

  def mo_step(_), do: nil

  @doc """
  Compact operation row for the production schedule page. Drops the
  cost / actual / worker noise — the schedule cares about position
  (workstation group + time window) and just enough MO context for
  the operator to identify the block at a glance.
  """
  def schedule_operation(%Backend.Production.ManufacturingOrderStep{} = s) do
    %{
      id: s.id,
      uuid: s.uuid,
      manufacturing_order_id: s.manufacturing_order_id,
      manufacturing_order: schedule_mo_summary(s.manufacturing_order),
      workstation_group_id: s.workstation_group_id,
      workstation_group: workstation_group_summary(s.workstation_group),
      operation_description: s.operation_description,
      planned_start: s.planned_start,
      planned_finish: s.planned_finish,
      planned_duration_seconds: s.planned_duration_seconds,
      planned_segments: s.planned_segments,
      actual_start: s.actual_start,
      actual_finish: s.actual_finish,
      quantity: decimal_to_string(s.quantity),
      sort_order: s.sort_order
    }
  end

  def schedule_operation(_), do: nil

  @doc """
  Backlog payload — the planner's left-rail feed of approved-but-
  unscheduled MOs. Carries enough context to render the rail row +
  decide where on the calendar to drop it (total duration = sum of
  step durations).
  """
  def backlog_mo(%Backend.Production.ManufacturingOrder{} = mo) do
    steps =
      case mo.steps do
        %Ecto.Association.NotLoaded{} -> []
        list when is_list(list) -> list
      end

    total_duration =
      Enum.reduce(steps, 0, fn s, acc ->
        acc + (s.planned_duration_seconds || 0)
      end)

    %{
      id: mo.id,
      uuid: mo.uuid,
      code: render_code(mo, "manufacturing_order"),
      status: mo.status,
      revision: mo.revision,
      quantity: decimal_to_string(mo.quantity),
      due_date: mo.due_date,
      item: maybe_item_summary(mo.item),
      bom: bom_summary(mo.bom),
      assigned_to: actor(mo, :assigned_to),
      planned_duration_seconds: total_duration,
      step_count: length(steps),
      # Chain context so the FE backlog can group rows as
      # project > MO > op. parent_mo_id may point outside the
      # backlog (parent already scheduled / in-progress) — the FE
      # treats those as roots-of-what-it-can-see.
      parent_mo_id: mo.parent_mo_id,
      steps_summary:
        Enum.map(steps, fn s ->
          %{
            id: s.id,
            uuid: s.uuid,
            sort_order: s.sort_order,
            operation_description: s.operation_description,
            planned_duration_seconds: s.planned_duration_seconds || 0,
            workstation_group: workstation_group_summary(s.workstation_group)
          }
        end)
    }
  end

  def backlog_mo(_), do: nil

  defp schedule_mo_summary(%Backend.Production.ManufacturingOrder{} = mo) do
    %{
      id: mo.id,
      uuid: mo.uuid,
      code: render_code(mo, "manufacturing_order"),
      status: mo.status,
      quantity: decimal_to_string(mo.quantity),
      item: maybe_item_summary(mo.item),
      warehouse_id: mo.warehouse_id,
      parent_mo_id: mo.parent_mo_id,
      # Warehouse-pickup state needed by the schedule UI's Release
      # button + the "released" badge on calendar blocks.
      released_to_warehouse_at: mo.released_to_warehouse_at,
      pickup_window_hours: mo.pickup_window_hours,
      pickup_started_at: mo.pickup_started_at,
      pickup_completed_at: mo.pickup_completed_at,
      # Pre-release QC status: how many booked raw_material / packaging
      # lots are still in quarantine (not yet "available"). Populated by
      # Production.list_schedule_operations in one grouped query.
      qc_pending_count: mo.qc_pending_count || 0,
      # Bookings that can no longer satisfy this MO — either lot
      # fell out of `available` (QC rejected / quarantine / hold) or
      # the lot is over-allocated across MOs (peer ate more than
      # expected). Drives the "Bookings need attention" banner +
      # picker queue warning.
      broken_bookings_count: Map.get(mo, :broken_bookings_count) || 0,
      under_booked_count: Map.get(mo, :under_booked_count) || 0,
      # Detail lists for the release dialog so the planner sees
      # which item / lot is blocking instead of a generic count.
      # Lazy-loaded per summary — cheap for the small set of MOs
      # in a single schedule view.
      broken_bookings:
        Backend.Production.list_broken_bookings_for([mo.id])
        |> Enum.map(&broken_booking_row/1),
      under_booked_lines:
        Backend.Production.list_under_booked_lines_for([mo.id])
        |> Enum.map(&under_booked_line_row/1),
      # Lines covered by an open child MO but missing a real lot —
      # blocks Release (picker needs real lots) but not Prepare.
      lines_awaiting_child_output:
        Backend.Production.list_lines_awaiting_child_output_for([mo.id])
        |> Enum.map(&awaiting_child_line_row/1),
      # Bookings whose lot isn't fully in a `regular` warehouse cell
      # — sitting at production_feed / dispatch after a previous
      # run and waiting on return-pickup back to the warehouse.
      bookings_lot_off_warehouse:
        Backend.Production.list_bookings_with_lot_off_warehouse_for([mo.id])
        |> Enum.map(&off_warehouse_booking_row/1),
      needs_replan: mo.needs_replan,
      needs_replan_reason: mo.needs_replan_reason
    }
  end

  defp under_booked_line_row(r) do
    %{
      item_id: r.item_id,
      item_name: r.item_name,
      required: r.required,
      booked: r.booked,
      short: r.short
    }
  end

  defp off_warehouse_booking_row(r) do
    %{
      booking_uuid: r.booking_uuid,
      item_name: r.item_name,
      lot_uuid: r.lot_uuid,
      booked_qty: r.booked_qty,
      in_warehouse_qty: r.in_warehouse_qty
    }
  end

  defp awaiting_child_line_row(r) do
    %{
      item_id: r.item_id,
      item_name: r.item_name,
      required: r.required,
      booked: r.booked,
      short: r.short,
      waiting_on_children:
        Enum.map(r.waiting_on_children || [], fn c ->
          %{
            id: c.id,
            uuid: c.uuid,
            code: render_code(%{id: c.id}, "manufacturing_order"),
            status: c.status,
            quantity: c.quantity
          }
        end)
    }
  end

  defp schedule_mo_summary(_), do: nil

  defp mo_step_workers(%Backend.Production.ManufacturingOrderStep{} = s) do
    case Map.get(s, :worker_assignments) do
      %Ecto.Association.NotLoaded{} ->
        []

      list when is_list(list) ->
        list
        |> Enum.map(fn a ->
          case a.user do
            %Backend.Accounts.User{} = u ->
              %{id: u.id, uuid: u.uuid, name: u.name, email: u.email}

            _ ->
              nil
          end
        end)
        |> Enum.reject(&is_nil/1)

      _ ->
        []
    end
  end

  defp mo_step_parent_summary(%Backend.Production.ManufacturingOrder{} = mo) do
    %{
      id: mo.id,
      uuid: mo.uuid,
      code: render_code(mo, "manufacturing_order"),
      status: mo.status,
      quantity: decimal_to_string(mo.quantity)
    }
  end

  defp mo_step_parent_summary(_), do: nil

  # Total step time in seconds = setup_min × 60 + ceil(cycle_min ×
  # qty / capacity) × 60. Defaults handle nil values gracefully.
  defp step_duration_seconds(step, qty) do
    setup = step.setup_time_min || Decimal.new("0")
    cycle = step.cycle_time_min || Decimal.new("0")
    capacity = step.capacity || Decimal.new("1")
    quantity = qty || Decimal.new("0")

    cycle_total =
      if Decimal.equal?(capacity, Decimal.new("0")) do
        Decimal.new("0")
      else
        cycle
        |> Decimal.mult(quantity)
        |> Decimal.div(capacity)
      end

    total_minutes = Decimal.add(setup, cycle_total)
    # Floor to whole seconds — sub-second precision on a routing step
    # is noise.
    total_minutes
    |> Decimal.mult(Decimal.new("60"))
    |> Decimal.round(0, :ceiling)
    |> Decimal.to_integer()
  end


  defp routing_steps_list(%Backend.Production.Routing{steps: %Ecto.Association.NotLoaded{}}),
    do: []

  defp routing_steps_list(%Backend.Production.Routing{steps: steps}) when is_list(steps),
    do: steps |> Enum.sort_by(& &1.sort_order) |> Enum.map(&routing_step/1)

  defp routing_steps_list(_), do: []

  defp routing_step_workers(%Backend.Production.RoutingStep{} = s) do
    case Map.get(s, :worker_assignments) do
      %Ecto.Association.NotLoaded{} ->
        []

      list when is_list(list) ->
        Enum.map(list, fn a ->
          case a.user do
            %Backend.Accounts.User{} = u ->
              %{id: u.id, uuid: u.uuid, name: u.name, email: u.email}

            _ ->
              nil
          end
        end)
        |> Enum.reject(&is_nil/1)

      _ ->
        []
    end
  end

  # Group rate when the workstation hasn't ticked the override; the
  # workstation's own rate when it has. Returned as a decimal string
  # (or nil).
  defp workstation_effective_rate(%Backend.Production.Workstation{} = w) do
    cond do
      w.hourly_rate_enabled and w.hourly_rate != nil ->
        decimal_to_string(w.hourly_rate)

      match?(%Backend.Production.WorkstationGroup{}, w.workstation_group) and
          w.workstation_group.hourly_rate_enabled ->
        decimal_to_string(w.workstation_group.hourly_rate)

      true ->
        nil
    end
  end

  # The station's own override when set; otherwise the group's default.
  # Mirrors the resolution the routing-step form will run on the FE.
  defp workstation_effective_operation_notes(%Backend.Production.Workstation{} = w) do
    cond do
      is_binary(w.default_operation_notes) and w.default_operation_notes != "" ->
        w.default_operation_notes

      match?(%Backend.Production.WorkstationGroup{}, w.workstation_group) ->
        w.workstation_group.default_operation_notes

      true ->
        nil
    end
  end

  defp workstation_default_workers(%Backend.Production.Workstation{} = w) do
    case Map.get(w, :default_worker_assignments) do
      %Ecto.Association.NotLoaded{} ->
        []

      list when is_list(list) ->
        Enum.map(list, fn a ->
          case a.user do
            %Backend.Accounts.User{} = u ->
              %{id: u.id, uuid: u.uuid, name: u.name, email: u.email}

            _ ->
              nil
          end
        end)
        |> Enum.reject(&is_nil/1)

      _ ->
        []
    end
  end

  # Minimal site card on a workstation payload — full warehouse
  # payload pulls in readiness which we don't need here.
  defp maybe_site_summary(%Backend.Warehouses.Warehouse{} = w) do
    %{
      id: w.id,
      uuid: w.uuid,
      code: render_code(w, "warehouse"),
      name: w.name,
      kind: w.kind
    }
  end

  defp maybe_site_summary(_), do: nil

  defp preloaded_list(record, field, shape_fn) do
    case Map.get(record, field) do
      %Ecto.Association.NotLoaded{} -> []
      nil -> []
      list when is_list(list) -> Enum.map(list, shape_fn)
    end
  end

  # ----- purchase orders -------------------------------------------

  def purchase_order(po) do
    %{
      id: po.id,
      uuid: po.uuid,
      code: render_code(po, "purchase_order"),
      status: po.status,
      vendor_id: po.vendor_id,
      vendor: preloaded_or_nil(po, :vendor, &vendor_summary/1),
      currency_code: po.currency_code,
      subtotal: po.subtotal,
      discount_pct: po.discount_pct,
      discount_amount: po.discount_amount,
      tax_rate: po.tax_rate,
      tax_amount: po.tax_amount,
      shipping_fees: po.shipping_fees,
      additional_fees: po.additional_fees,
      grand_total: po.grand_total,
      # Legacy field — `grand_total` is the new source of truth. Kept
      # so v1 FE callers don't blow up mid-deploy.
      total_amount: po.total_amount,
      default_warehouse_id: po.default_warehouse_id,
      default_warehouse: preloaded_or_nil(po, :default_warehouse, &warehouse_compact/1),
      expected_delivery_date: po.expected_delivery_date,
      delivery_address: po.delivery_address,
      notes: po.notes,
      submitted_at: po.submitted_at,
      submitted_by: actor(po, :submitted_by),
      ordered_at: po.ordered_at,
      ordered_by: actor(po, :ordered_by),
      received_at: po.received_at,
      received_by: actor(po, :received_by),
      cancelled_at: po.cancelled_at,
      cancelled_by: actor(po, :cancelled_by),
      cancellation_reason: po.cancellation_reason,
      is_rnd: po.is_rnd || false,
      lines: preloaded_list(po, :lines, &purchase_order_line/1),
      approvals: preloaded_list(po, :approvals, &purchase_order_approval/1),
      files: preloaded_list(po, :files, fn f -> po_file(f, po) end),
      inserted_at: po.inserted_at,
      updated_at: po.updated_at,
      created_by: actor(po, :created_by),
      updated_by: actor(po, :updated_by)
    }
  end

  def purchase_order_line(l) do
    %{
      id: l.id,
      uuid: l.uuid,
      purchase_order_id: l.purchase_order_id,
      item_id: l.item_id,
      item: maybe_item_summary(l.item),
      warehouse_id: Map.get(l, :warehouse_id),
      warehouse: preloaded_or_nil(l, :warehouse, &warehouse_compact/1),
      vendor_part_no: Map.get(l, :vendor_part_no),
      qty_ordered: l.qty_ordered,
      qty_received: l.qty_received,
      unit_price: l.unit_price,
      line_subtotal: l.line_subtotal,
      expected_delivery_date: l.expected_delivery_date,
      notes: l.notes,
      inserted_at: l.inserted_at,
      updated_at: l.updated_at,
      # The day-one child stock_lot. Present from PO create time so the
      # FE can render the LOT chip on each line and MO planners can
      # deep-link into the lot detail before physical receipt.
      child_lot: preloaded_or_nil(l, :child_lot, &po_line_child_lot/1)
    }
  end

  # Compact stock_lot summary embedded on a PO line row — just enough
  # for the FE to render the LOT code + status pill without pulling
  # the whole lot payload.
  defp po_line_child_lot(%Backend.Stock.Lot{} = lot) do
    %{
      id: lot.id,
      uuid: lot.uuid,
      code: render_code(lot, "stock_lot"),
      status: lot.status
    }
  end

  defp po_line_child_lot(_), do: nil

  @doc """
  Compact warehouse representation embedded in PO header (default
  delivery site) and per PO line. The FE shows the name + code; full
  warehouse detail is one click away via the warehouse uuid.
  """
  def warehouse_compact(%Backend.Warehouses.Warehouse{} = w) do
    %{
      id: w.id,
      uuid: w.uuid,
      code: render_code(w, "warehouse"),
      name: w.name
    }
  end

  def warehouse_compact(_), do: nil

  @doc """
  Public payload for a stored PO file. Includes a serve URL scoped
  under the parent PO uuid so files only resolve under their owning
  record — mirrors `vendor_file/2`.
  """
  def po_file(%Backend.Purchasing.PurchaseOrderFile{} = f, po) do
    po_uuid = po && Map.get(po, :uuid)

    %{
      id: f.id,
      uuid: f.uuid,
      kind: f.kind,
      filename: f.filename,
      mime: f.mime,
      byte_size: f.byte_size,
      url:
        po_uuid &&
          "/api/purchase-orders/" <>
            po_uuid <> "/files/" <> f.uuid <> "/serve",
      uploaded_at: f.inserted_at,
      uploaded_by: actor(f, :uploaded_by)
    }
  end

  @doc """
  AP-ledger row shape. Surfaces the totals + payment state + the PDF
  link if attached, plus a slim PO/vendor reference for the global
  invoices page.
  """
  def procurement_invoice(i) do
    po = i.purchase_order

    %{
      id: i.id,
      uuid: i.uuid,
      purchase_order_id: i.purchase_order_id,
      purchase_order:
        po &&
          %{
            uuid: po.uuid,
            code: render_code(po, "purchase_order"),
            status: po.status,
            vendor: po && po.vendor && vendor_summary(po.vendor)
          },
      invoice_number: i.invoice_number,
      invoice_date: i.invoice_date,
      due_date: i.due_date,
      currency_code: i.currency_code,
      subtotal: i.subtotal,
      tax_amount: i.tax_amount,
      total_inc_tax: i.total_inc_tax,
      paid_amount: i.paid_amount,
      status: i.status,
      derived_overdue:
        i.status == "received" and not is_nil(i.due_date) and
          Date.compare(i.due_date, Date.utc_today()) == :lt,
      notes: i.notes,
      file:
        i.file_blob_path &&
          %{
            filename: i.file_filename,
            mime: i.file_mime,
            byte_size: i.file_byte_size,
            url: "/api/procurement/invoices/" <> i.uuid <> "/file/serve"
          },
      paid_at: i.paid_at,
      paid_by: actor(i, :paid_by),
      created_by: actor(i, :created_by),
      updated_by: actor(i, :updated_by),
      inserted_at: i.inserted_at,
      updated_at: i.updated_at
    }
  end

  def purchase_order_approval(a) do
    %{
      uuid: a.uuid,
      purchase_order_id: a.purchase_order_id,
      kind: a.kind,
      signed_at: a.signed_at,
      signed_by: actor(a, :signed_by),
      notes: a.notes,
      # Don't ship the base64 signature image on list payloads — too
      # large. Detail-page payload includes it via a dedicated
      # `purchase_order_approval_detail/1` if/when needed.
      has_signature_image: not is_nil(a.signature_image)
    }
  end

  @doc """
  One row from a polymorphic comment thread. Shape mirrors what the
  FE comment-thread component needs in one pass — avatar + name +
  relative-time + body + edit/delete handles.

  `parent_comment_id` is exposed so the v2 threaded UI can stitch
  replies. `mentioned_user_ids` is the v2 notification fan-out target.
  """
  def comment(c), do: comment(c, nil)

  def comment(c, current_user_id) do
    %{
      id: c.id,
      uuid: c.uuid,
      entity_type: c.entity_type,
      entity_id: c.entity_id,
      body: c.body,
      visibility: c.visibility,
      parent_comment_id: c.parent_comment_id,
      parent: comment_parent(c),
      mentioned_user_ids: c.mentioned_user_ids || [],
      edited_at: c.edited_at,
      created_at: c.inserted_at,
      updated_at: c.updated_at,
      author: actor(c, :author),
      files: preloaded_list(c, :files, &comment_file/1),
      reactions: comment_reactions(c, current_user_id)
    }
  end

  # Compact parent reference for threaded replies. `snippet` is the first
  # 80 chars of the parent body so the reply bubble can show "in reply
  # to: 'Please double-check the COA…'" without a second fetch.
  defp comment_parent(%{parent_comment: %Ecto.Association.NotLoaded{}}), do: nil
  defp comment_parent(%{parent_comment: nil}), do: nil

  defp comment_parent(%{parent_comment: %Backend.Comments.Comment{} = parent}) do
    %{
      id: parent.id,
      uuid: parent.uuid,
      author_name: parent_author_name(parent),
      snippet: comment_snippet(parent.body)
    }
  end

  defp comment_parent(_), do: nil

  defp parent_author_name(%Backend.Comments.Comment{author: %Ecto.Association.NotLoaded{}}), do: nil

  defp parent_author_name(%Backend.Comments.Comment{author: %{name: name}}) when is_binary(name),
    do: name

  defp parent_author_name(_), do: nil

  defp comment_snippet(nil), do: ""

  defp comment_snippet(body) when is_binary(body) do
    trimmed = String.trim(body)

    if String.length(trimmed) > 80 do
      String.slice(trimmed, 0, 80) <> "…"
    else
      trimmed
    end
  end

  def comment_file(%Backend.Comments.CommentFile{} = f) do
    %{
      id: f.id,
      uuid: f.uuid,
      kind: f.kind,
      filename: f.filename,
      mime: f.mime,
      byte_size: f.byte_size,
      url: Backend.Storage.public_url(f.blob_path),
      width_px: f.width_px,
      height_px: f.height_px,
      duration_ms: f.duration_ms,
      waveform: f.waveform,
      uploaded_at: f.inserted_at,
      uploaded_by: actor(f, :uploaded_by)
    }
  end

  defp comment_reactions(%{reactions: %Ecto.Association.NotLoaded{}}, _), do: []
  defp comment_reactions(%{reactions: nil}, _), do: []

  defp comment_reactions(%{reactions: reactions}, current_user_id) when is_list(reactions) do
    Backend.Comments.collapse_reactions(reactions, current_user_id)
    |> Enum.map(fn %{emoji: emoji, count: count, user_ids: user_ids, own_reacted: own} ->
      %{emoji: emoji, count: count, user_ids: user_ids, own_reacted: own}
    end)
  end

  defp comment_reactions(_, _), do: []

  @doc """
  Goods-In Inspection — BRCGS / FSSC 22000 incoming-inspection record.
  Eight sections + dual ESIGN. Per-line decisions live on `items`.
  """
  def goods_in_inspection(i) do
    %{
      id: i.id,
      uuid: i.uuid,
      code: render_code(i, "goods_in_inspection"),
      status: i.status,
      delivery_date: i.delivery_date,
      delivery_time: i.delivery_time,
      transport_company: i.transport_company,
      vehicle_registration: i.vehicle_registration,
      seal_number: i.seal_number,
      vehicle_inspection: i.vehicle_inspection || %{},
      documentation_verification: i.documentation_verification || %{},
      physical_inspection: i.physical_inspection || %{},
      food_safety_checks: i.food_safety_checks || %{},
      storage_verification: i.storage_verification || %{},
      quality_decision: i.quality_decision,
      quality_decision_reason: i.quality_decision_reason,
      goods_in_operator: actor(i, :goods_in_operator),
      goods_in_operator_signed_at: i.goods_in_operator_signed_at,
      # Base64 data URLs — only on the detail payload (not in the
      # ledger summary) since they're heavy. The desktop detail page
      # renders them inline so QC can audit the actual scrawl.
      goods_in_operator_signature_image: i.goods_in_operator_signature_image,
      quality_approver: actor(i, :quality_approver),
      quality_approver_signed_at: i.quality_approver_signed_at,
      quality_approver_signature_image: i.quality_approver_signature_image,
      purchase_order_id: i.purchase_order_id,
      purchase_order_uuid: maybe_po_uuid(i),
      purchase_order_code: maybe_po_code(i),
      items: maybe_list(i.items, &goods_in_inspection_item/1),
      files: preloaded_list(i, :files, fn f -> goods_in_inspection_file(f, i) end),
      inserted_at: i.inserted_at,
      updated_at: i.updated_at
    }
  end

  @doc """
  Public payload for a stored goods-in file. Mirrors `po_file/2` — URL
  points back at the serve endpoint scoped under the parent
  inspection uuid so files only resolve under their owner.
  """
  def goods_in_inspection_file(%Backend.GoodsIn.InspectionFile{} = f, inspection) do
    insp_uuid = inspection && Map.get(inspection, :uuid)

    %{
      id: f.id,
      uuid: f.uuid,
      kind: f.kind,
      filename: f.filename,
      mime: f.mime,
      byte_size: f.byte_size,
      url:
        insp_uuid &&
          "/api/goods-in-inspections/" <>
            insp_uuid <> "/files/" <> f.uuid <> "/serve",
      uploaded_at: f.inserted_at,
      uploaded_by: actor(f, :uploaded_by)
    }
  end

  defp maybe_po_uuid(%{purchase_order: %{uuid: uuid}}) when is_binary(uuid), do: uuid
  defp maybe_po_uuid(_), do: nil

  defp maybe_po_code(%{purchase_order: %Backend.Purchasing.PurchaseOrder{} = po}),
    do: render_code(po, "purchase_order")
  defp maybe_po_code(_), do: nil

  @doc """
  Slim "inspections ledger" row — fields the global desktop ledger
  needs without loading the full 8-section payload. Mirrors the
  `procurement_invoice` shape so the desktop tables feel the same.
  """
  def goods_in_inspection_summary(%Backend.GoodsIn.Inspection{} = i) do
    %{
      id: i.id,
      uuid: i.uuid,
      code: render_code(i, "goods_in_inspection"),
      status: i.status,
      delivery_date: i.delivery_date,
      quality_decision: i.quality_decision,
      goods_in_operator: actor(i, :goods_in_operator),
      goods_in_operator_signed_at: i.goods_in_operator_signed_at,
      quality_approver: actor(i, :quality_approver),
      quality_approver_signed_at: i.quality_approver_signed_at,
      purchase_order: maybe_po_summary(i.purchase_order),
      inserted_at: i.inserted_at,
      updated_at: i.updated_at
    }
  end

  defp maybe_po_summary(%Backend.Purchasing.PurchaseOrder{} = po) do
    %{
      id: po.id,
      uuid: po.uuid,
      code: render_code(po, "purchase_order"),
      status: po.status,
      vendor: preloaded_or_nil(po, :vendor, &vendor_summary/1)
    }
  end

  defp maybe_po_summary(_), do: nil

  def goods_in_inspection_item(item) do
    %{
      id: item.id,
      uuid: item.uuid,
      purchase_order_line_id: item.purchase_order_line_id,
      purchase_order_line_uuid: maybe_po_line_uuid(item),
      qty_received: item.qty_received,
      packaging_condition: item.packaging_condition,
      packaging_condition_notes: item.packaging_condition_notes,
      material_decision: item.material_decision,
      material_decision_reason: item.material_decision_reason,
      packs: item.packs || [],
      inserted_at: item.inserted_at,
      updated_at: item.updated_at
    }
  end

  defp maybe_po_line_uuid(%{purchase_order_line: %{uuid: uuid}}) when is_binary(uuid), do: uuid
  defp maybe_po_line_uuid(_), do: nil

  defp maybe_list(items, fun) when is_list(items), do: Enum.map(items, fun)
  defp maybe_list(_, _), do: []

  @doc """
  Suggest-price endpoint payload. Returns `nil` when there's no
  history so the FE can branch on `last_paid == null` without a
  separate "missing" code.
  """
  @doc """
  One purchase-term row shaped for both the vendor detail page and
  the item detail page. Vendor + item summaries embed when preloaded
  so the FE renders identity chips without extra fetches; either can
  be omitted based on the calling surface (vendor-page rows already
  know the vendor, item-page rows already know the item).
  """
  def purchase_term(%Backend.Purchasing.PurchaseTerm{} = row) do
    %{
      uuid: row.uuid,
      vendor_id: row.vendor_id,
      item_id: row.item_id,
      vendor: maybe_vendor_summary(row.vendor),
      item: maybe_item_summary(row.item),
      vendor_part_no: row.vendor_part_no,
      lead_time_days: row.lead_time_days,
      price: row.price,
      currency_code: row.currency_code,
      min_quantity: row.min_quantity,
      min_quantity_uom: row.min_quantity_uom,
      priority: row.priority,
      valid_from: row.valid_from,
      valid_until: row.valid_until,
      notes: row.notes,
      inserted_at: row.inserted_at,
      updated_at: row.updated_at
    }
  end

  defp maybe_vendor_summary(%Backend.Vendors.Vendor{} = v) do
    %{
      id: v.id,
      uuid: v.uuid,
      code: v.code,
      name: v.name,
      approval_status: v.approval_status
    }
  end

  defp maybe_vendor_summary(_), do: nil

  def vendor_item_price_suggestion(nil), do: nil

  def vendor_item_price_suggestion(%{
        unit_price: unit_price,
        currency_code: currency_code,
        last_paid_at: last_paid_at,
        last_po_line_id: last_po_line_id,
        qty_purchased: qty_purchased
      }) do
    %{
      unit_price: unit_price,
      currency_code: currency_code,
      last_paid_at: last_paid_at,
      last_po_line_id: last_po_line_id,
      qty_purchased: qty_purchased
    }
  end

  @doc """
  One row of the vendor-detail "Price history" card. Item is preloaded
  so the FE can render the name + code without a second fetch; the
  source PO is linked for receipts traceability.
  """
  def vendor_item_price(%Backend.Purchasing.VendorItemPrice{} = row) do
    %{
      uuid: row.uuid,
      item_id: row.item_id,
      item: maybe_item_summary(row.item),
      currency_code: row.currency_code,
      unit_price: row.unit_price,
      qty_purchased: row.qty_purchased,
      last_paid_at: row.last_paid_at,
      last_po_line_id: row.last_po_line_id,
      last_po_uuid: vendor_item_price_po_uuid(row),
      updated_at: row.updated_at
    }
  end

  defp vendor_item_price_po_uuid(%{last_po_line: %{purchase_order: %{uuid: uuid}}}), do: uuid
  defp vendor_item_price_po_uuid(_), do: nil

  defp maybe_certificate_compact(%Backend.Certificates.Certificate{} = c) do
    %{
      id: c.id,
      uuid: c.uuid,
      name: c.name,
      certificate_type: c.certificate_type,
      issuing_body: c.issuing_body
    }
  end

  defp maybe_certificate_compact(_), do: nil

  def packaging_compliance(p, item \\ nil) do
    %{
      material: p.material,
      food_contact_compliant: p.food_contact_compliant,
      food_contact_declaration_file:
        maybe_item_file(p, :food_contact_declaration_file, item),
      food_contact_declaration_file_id: p.food_contact_declaration_file_id,
      recyclability_code: p.recyclability_code,
      migration_test_file: maybe_item_file(p, :migration_test_file, item),
      migration_test_file_id: p.migration_test_file_id,
      migration_test_expires_at: p.migration_test_expires_at,
      inserted_at: p.inserted_at,
      updated_at: p.updated_at
    }
  end

  def finished_product_spec(s, item \\ nil) do
    %{
      regulatory_category: s.regulatory_category,
      dosage_form: s.dosage_form,
      capsule_size: s.capsule_size,
      tablet_size_mm: decimal_to_string(s.tablet_size_mm),
      powder_type: s.powder_type,
      serving_size: decimal_to_string(s.serving_size),
      serving_size_uom: maybe_unit_compact(s.serving_size_uom),
      serving_size_uom_id: s.serving_size_uom_id,
      servings_per_pack: s.servings_per_pack,
      net_quantity: decimal_to_string(s.net_quantity),
      net_quantity_uom: maybe_unit_compact(s.net_quantity_uom),
      net_quantity_uom_id: s.net_quantity_uom_id,
      directions_of_use: s.directions_of_use,
      suggested_dosage: s.suggested_dosage,
      warnings_text: s.warnings_text,
      appearance: s.appearance,
      disintegration_spec: s.disintegration_spec,
      weight_uniformity_pct: decimal_to_string(s.weight_uniformity_pct),
      shelf_life_months: s.shelf_life_months,
      storage_conditions: s.storage_conditions,
      food_contact_status: s.food_contact_status,
      active_claims: s.active_claims || [],
      general_claims: s.general_claims || [],
      nutrition_table: s.nutrition_table || %{},
      target_markets: s.target_markets || [],
      spec_document_file: maybe_item_file(s, :spec_document_file, item),
      spec_document_file_id: s.spec_document_file_id,
      may_contain_allergens: s.may_contain_allergens || [],
      may_contain_justification: s.may_contain_justification,
      may_contain_assessed_at: s.may_contain_assessed_at,
      may_contain_assessed_by: actor(s, :may_contain_assessed_by),
      contaminant_limits_overrides: s.contaminant_limits_overrides || %{},
      inserted_at: s.inserted_at,
      updated_at: s.updated_at
    }
  end

  defp add_optional(map, _key, %Ecto.Association.NotLoaded{}, _shaper), do: map
  defp add_optional(map, key, nil, _shaper), do: Map.put(map, key, nil)
  defp add_optional(map, key, value, shaper), do: Map.put(map, key, shaper.(value))

  # Special-case shaper for the raw-material compliance subtable so an
  # attributes-only item still surfaces a payload (see call site for
  # rationale). Skips entirely on list endpoints (subtable unloaded)
  # and on non-raw-material types (nothing to synthesise for them).
  defp add_raw_material_compliance(
         map,
         %Backend.Items.Item{raw_material_compliance: %Ecto.Association.NotLoaded{}}
       ),
       do: map

  defp add_raw_material_compliance(
         map,
         %Backend.Items.Item{item_type: "raw_material"} = item
       ) do
    Map.put(map, :raw_material_compliance, raw_material_compliance(item.raw_material_compliance, item))
  end

  defp add_raw_material_compliance(map, %Backend.Items.Item{raw_material_compliance: nil}),
    do: Map.put(map, :raw_material_compliance, nil)

  defp add_raw_material_compliance(
         map,
         %Backend.Items.Item{raw_material_compliance: c} = item
       ),
       do: Map.put(map, :raw_material_compliance, raw_material_compliance(c, item))

  @doc """
  Shape a raw-material compliance blob for the item detail payload.

  Accepts a ``%RawMaterialCompliance{}`` (real side-table row) OR
  ``nil`` (subtable row doesn't exist yet). The ``use_as`` field is
  the dual-source one: the JSONB ``attributes.use_as`` on the item
  (Title Case, populated by the NPD integration wire) is a fallback
  when the side-table column is blank. Every other field is
  side-table-only; when there's no row, they emit as ``nil`` and the
  compliance-blocker check flags the whole subtable as missing.
  """
  def raw_material_compliance(c, item \\ nil)

  def raw_material_compliance(nil, item) do
    use_as =
      case item do
        %Backend.Items.Item{attributes: attrs} when is_map(attrs) ->
          Backend.Items.RawMaterialCompliance.snake_use_as(Map.get(attrs, "use_as"))

        _ ->
          nil
      end

    %{
      use_as: use_as,
      allergen_status: nil,
      vegan_status: nil,
      halal_status: nil,
      kosher_status: nil,
      organic_status: nil,
      novel_food_status: nil,
      gmo_status: nil,
      country_of_origin: nil,
      purity_pct: nil,
      extract_ratio: nil,
      overage_pct: nil,
      powder_water_dose_mg_per_ml: nil,
      shelf_life_months: nil,
      storage_conditions: nil,
      spec_document_file: nil,
      spec_document_file_id: nil,
      last_reviewed_at: nil,
      last_reviewed_by: nil,
      review_frequency_months: nil,
      review_due_at: nil,
      inserted_at: nil,
      updated_at: nil
    }
  end

  def raw_material_compliance(c, item) do
    # Fall through to ``attributes.use_as`` when the side-table
    # column is blank — same reason as the nil-subtable branch.
    resolved_use_as =
      case {c.use_as, item} do
        {value, _} when is_binary(value) and value != "" ->
          value

        {_, %Backend.Items.Item{attributes: attrs}} when is_map(attrs) ->
          Backend.Items.RawMaterialCompliance.snake_use_as(Map.get(attrs, "use_as"))

        _ ->
          c.use_as
      end

    %{
      use_as: resolved_use_as,
      allergen_status: c.allergen_status,
      vegan_status: c.vegan_status,
      halal_status: c.halal_status,
      kosher_status: c.kosher_status,
      organic_status: c.organic_status,
      novel_food_status: c.novel_food_status,
      gmo_status: c.gmo_status,
      country_of_origin: c.country_of_origin,
      purity_pct: decimal_to_string(c.purity_pct),
      extract_ratio: c.extract_ratio,
      overage_pct: decimal_to_string(c.overage_pct),
      powder_water_dose_mg_per_ml: decimal_to_string(c.powder_water_dose_mg_per_ml),
      shelf_life_months: c.shelf_life_months,
      storage_conditions: c.storage_conditions,
      spec_document_file: maybe_item_file(c, :spec_document_file, item),
      spec_document_file_id: c.spec_document_file_id,
      last_reviewed_at: c.last_reviewed_at,
      last_reviewed_by: actor(c, :last_reviewed_by),
      review_frequency_months: c.review_frequency_months,
      review_due_at: c.review_due_at,
      inserted_at: c.inserted_at,
      updated_at: c.updated_at
    }
  end

  def raw_material_risk(r) do
    %{
      physical_risk_score: r.physical_risk_score,
      chemical_risk_score: r.chemical_risk_score,
      biological_risk_score: r.biological_risk_score,
      allergen_risk_score: r.allergen_risk_score,
      radiological_risk_score: r.radiological_risk_score,
      fraud_vulnerability_score: r.fraud_vulnerability_score,
      malicious_risk_score: r.malicious_risk_score,
      computed_overall_level: r.computed_overall_level,
      overridden_overall_level: r.overridden_overall_level,
      override_justification: r.override_justification,
      justification: r.justification,
      required_controls: r.required_controls,
      assessed_at: r.assessed_at,
      assessed_by: actor(r, :assessed_by),
      inserted_at: r.inserted_at,
      updated_at: r.updated_at
    }
  end

  defp maybe_unit_compact(%Backend.Units.UnitOfMeasurement{} = u),
    do: %{id: u.id, uuid: u.uuid, name: u.name, symbol: u.symbol, dimension: u.dimension}

  defp maybe_unit_compact(_), do: nil

  defp maybe_family_compact(%Backend.Catalogs.ProductFamily{} = f),
    do: %{id: f.id, uuid: f.uuid, name: f.name}

  defp maybe_family_compact(_), do: nil

  def product_family(f) do
    %{
      id: f.id,
      uuid: f.uuid,
      code: render_code(f, "product_family"),
      name: f.name,
      description: f.description,
      is_active: f.is_active,
      inserted_at: f.inserted_at,
      updated_at: f.updated_at,
      created_by: actor(f, :created_by),
      updated_by: actor(f, :updated_by)
    }
  end

  def attribute_definition(a) do
    %{
      id: a.id,
      uuid: a.uuid,
      code: render_code(a, "attribute_definition"),
      scope: a.scope,
      key: a.key,
      label: a.label,
      attribute_type: a.attribute_type,
      enum_choices: a.enum_choices || [],
      required: a.required,
      default_value: a.default_value,
      unit_symbol: a.unit_symbol,
      help_text: a.help_text,
      sort_order: a.sort_order,
      is_active: a.is_active,
      inserted_at: a.inserted_at,
      updated_at: a.updated_at,
      created_by: actor(a, :created_by),
      updated_by: actor(a, :updated_by)
    }
  end

  def allergen(a) do
    %{
      uuid: a.uuid,
      key: a.key,
      label: a.label,
      source: a.source,
      sort_order: a.sort_order
    }
  end

  def claim(c) do
    %{
      uuid: c.uuid,
      claim_code: c.claim_code,
      claim_text: c.claim_text,
      category: c.category,
      nutrient_substance: c.nutrient_substance,
      conditions_of_use: c.conditions_of_use,
      jurisdictions: c.jurisdictions || [],
      source: c.source,
      status: c.status
    }
  end

  @doc """
  One row from the company-scoped units-of-measurement registry.
  `factor_to_base` is serialised as a string so JS doesn't lose
  precision on tiny ratios (e.g. mg → kg = 0.000001).
  """
  def unit_of_measurement(u) do
    %{
      id: u.id,
      uuid: u.uuid,
      code: render_code(u, "unit_of_measurement"),
      name: u.name,
      symbol: u.symbol,
      dimension: u.dimension,
      factor_to_base: decimal_to_string(u.factor_to_base),
      is_base: u.is_base,
      is_active: u.is_active,
      inserted_at: u.inserted_at,
      updated_at: u.updated_at,
      created_by: actor(u, :created_by),
      updated_by: actor(u, :updated_by)
    }
  end

  defp decimal_to_string(%Decimal{} = d), do: Decimal.to_string(d, :normal)
  defp decimal_to_string(other), do: other

  @doc """
  One level of a storage location. Cells stack from `ordinal: 0`
  (bottom) upward. Dimensions in metres, tags freeform.
  """
  def storage_cell(c) do
    %{
      id: c.id,
      uuid: c.uuid,
      storage_location_id: c.storage_location_id,
      ordinal: c.ordinal,
      name: c.name,
      width_m: c.width_m,
      depth_m: c.depth_m,
      height_m: c.height_m,
      max_weight_kg: c.max_weight_kg,
      tags: c.tags || [],
      # Cell intent — drives the auto-router. Surfaces on the plan
      # editor as a chip + select, and on the lot detail placement
      # card so QC can spot a quarantine lot in a regular cell at a
      # glance.
      purpose: c.purpose || "regular",
      notes: c.notes,
      inserted_at: c.inserted_at,
      updated_at: c.updated_at,
      created_by: actor(c, :created_by),
      updated_by: actor(c, :updated_by)
    }
  end

  @doc """
  Stock lot — the logical batch identity. qty_on_hand and
  qty_available are derived from placements; callers should preload
  placements before calling this shaper so the sum is one Decimal
  reduce rather than a query.
  """
  def stock_lot(l) do
    # Drop qty=0 ghost placements defensively. The move/adjust paths
    # now delete the row when qty hits zero, but old data + any
    # future caller that forgets to clean up shouldn't leak ghosts
    # into cell-contents views (the quarantine-cage symptom that
    # prompted this filter).
    placements =
      l
      |> preloaded_or_empty(:placements)
      |> Enum.reject(fn p ->
        Decimal.compare(p.qty || Decimal.new(0), Decimal.new(0)) != :gt
      end)

    qty_on_hand = sum_decimal(placements, & &1.qty)

    %{
      id: l.id,
      uuid: l.uuid,
      code: render_code(l, "stock_lot"),
      status: l.status,
      qty_received: l.qty_received,
      qty_on_hand: qty_on_hand,
      qty_available: qty_on_hand,
      unit_cost: l.unit_cost,
      currency: l.currency,
      source_kind: l.source_kind,
      source_ref: l.source_ref,
      supplier_batch_no: l.supplier_batch_no,
      country_of_origin: l.country_of_origin,
      revision: l.revision,
      overall_risk: l.overall_risk,
      allergen_status: l.allergen_status,
      coa_status: l.coa_status,
      quality_status: l.quality_status,
      manufactured_at: l.manufactured_at,
      expiry_at: l.expiry_at,
      available_from: l.available_from,
      received_at: l.received_at,
      notes: l.notes,
      item_id: l.item_id,
      item: preloaded_or_nil(l, :item, &item_summary/1),
      unit_of_measurement_id: l.unit_of_measurement_id,
      unit_of_measurement: preloaded_or_nil(l, :unit_of_measurement, &uom_summary/1),
      placements: Enum.map(placements, &stock_lot_placement/1),
      package_length_mm: l.package_length_mm,
      package_width_mm: l.package_width_mm,
      package_height_mm: l.package_height_mm,
      package_weight_kg: l.package_weight_kg,
      units_per_package: l.units_per_package,
      stack_factor: l.stack_factor,
      is_rnd: l.is_rnd || false,
      # 3PL / bailee custody snapshot. `own` = we own the goods (default);
      # `bailee` = customer-owned, held by us post Positive Release +
      # 3PL routing. `bailee_customer` + `bailee_routed_at` populate
      # only in the bailee case; the wizard-driven route action stamps
      # them atomically with `ownership_kind`.
      ownership_kind: l.ownership_kind,
      bailee_routed_at: l.bailee_routed_at,
      bailee_customer:
        preloaded_or_nil(l, :bailee_customer, fn c ->
          %{id: c.id, uuid: c.uuid, name: c.name}
        end),
      # Goods-In Inspection that produced this lot (when applicable).
      # Carries the full QA story so the lot detail page can render
      # vehicle/paperwork/physical sections + sign-offs + photos
      # without a second fetch.
      goods_in_inspection:
        preloaded_or_nil(l, :goods_in_inspection, &goods_in_inspection/1),
      # Direct lot file attachments (CoA, QC reports, photos that
      # weren't part of the inspection bundle).
      files: preloaded_list(l, :files, &lot_file_payload/1),
      # MO bookings referencing this lot — every pick + confirm +
      # consume sign-off across every MO that consumed from it.
      mo_bookings: preloaded_list(l, :mo_bookings, &lot_mo_booking_summary/1),
      # Return picks (production → warehouse) for this lot.
      return_picks:
        preloaded_list(l, :return_picks, &lot_return_pick_summary/1),
      inserted_at: l.inserted_at,
      updated_at: l.updated_at,
      created_by: actor(l, :created_by),
      updated_by: actor(l, :updated_by)
    }
  end

  defp lot_file_payload(%Backend.Stock.LotFile{} = f) do
    %{
      id: f.id,
      uuid: f.uuid,
      kind: f.kind,
      filename: f.filename,
      mime: f.mime,
      byte_size: f.byte_size,
      # No serve route wired yet — direct lot-file uploads aren't
      # exposed in any UI today (files mostly come through inspection
      # uploads). The FE renders the metadata as a read-only list.
      url: nil,
      uploaded_by: actor(f, :uploaded_by),
      inserted_at: f.inserted_at
    }
  end

  defp lot_mo_booking_summary(%Backend.Production.ManufacturingOrderBooking{} = b) do
    %{
      id: b.id,
      uuid: b.uuid,
      quantity: decimal_to_string(b.quantity),
      consumed_quantity: decimal_to_string(b.consumed_quantity),
      status: b.status,
      mo: lot_mo_booking_mo(b.manufacturing_order),
      picked_at: b.picked_at,
      picked_by: actor(b, :picked_by),
      received_at: b.received_at,
      received_by: actor(b, :received_by),
      received_qty: decimal_to_string(b.received_qty),
      received_notes: b.received_notes,
      consumed_at: b.consumed_at,
      consumed_by: actor(b, :consumed_by)
    }
  end

  defp lot_mo_booking_mo(%Backend.Production.ManufacturingOrder{} = mo) do
    %{
      id: mo.id,
      uuid: mo.uuid,
      code: render_code(mo, "manufacturing_order"),
      status: mo.status
    }
  end

  defp lot_mo_booking_mo(_), do: nil

  defp lot_return_pick_summary(%Backend.Warehouses.ReturnPick{} = r) do
    %{
      id: r.id,
      uuid: r.uuid,
      qty: decimal_to_string(r.qty),
      picked_at: r.picked_at,
      picked_by: actor(r, :picked_by),
      picked_photo_url: r.picked_photo_url,
      placed_at: r.placed_at,
      placed_by: actor(r, :placed_by),
      placed_photo_url: r.placed_photo_url,
      picked_from_cell:
        preloaded_or_nil(r, :picked_from_cell, &storage_cell_summary/1),
      placed_to_cell:
        preloaded_or_nil(r, :placed_to_cell, &storage_cell_summary/1)
    }
  end

  def stock_lot_placement(p) do
    %{
      id: p.id,
      uuid: p.uuid,
      stock_lot_id: p.stock_lot_id,
      storage_cell_id: p.storage_cell_id,
      qty: p.qty,
      storage_cell: preloaded_or_nil(p, :storage_cell, &storage_cell_summary/1),
      inserted_at: p.inserted_at,
      updated_at: p.updated_at
    }
  end

  @doc """
  Lot lifecycle event. The lot detail timeline reads off these — actor
  avatar + kind label + reason + optional evidence file. Metadata is
  passed through verbatim so the FE can render kind-specific extras
  (po_line_id on receive, qc_verdict on QC, etc.) without a per-kind
  payload contract.
  """
  def lot_event(e) do
    %{
      id: e.id,
      uuid: e.uuid,
      stock_lot_id: e.stock_lot_id,
      kind: e.kind,
      actor_kind: e.actor_kind,
      actor: actor(e, :actor),
      reason: e.reason,
      metadata: e.metadata || %{},
      evidence_file:
        case Map.get(e, :evidence_file) do
          %Ecto.Association.NotLoaded{} -> nil
          nil -> nil
          file -> %{uuid: file.uuid, filename: file.filename, mime: file.mime, kind: file.kind}
        end,
      occurred_at: e.occurred_at,
      inserted_at: e.inserted_at
    }
  end

  def stock_movement(m) do
    %{
      id: m.id,
      uuid: m.uuid,
      stock_lot_id: m.stock_lot_id,
      from_cell_id: m.from_cell_id,
      to_cell_id: m.to_cell_id,
      from_cell: preloaded_or_nil(m, :from_cell, &storage_cell_summary/1),
      to_cell: preloaded_or_nil(m, :to_cell, &storage_cell_summary/1),
      delta_qty: m.delta_qty,
      kind: m.kind,
      reason: m.reason,
      reference_kind: m.reference_kind,
      reference_ref: m.reference_ref,
      occurred_at: m.occurred_at,
      actor: actor(m, :actor),
      # For `issue` movements: who received the stock. Distinct from
      # `actor` (who did the issuing). Nullable — bulk shift issues
      # don't always track an individual recipient.
      issued_to_user: actor(m, :issued_to_user),
      photo_url: m.photo_url,
      skip_photo_reason: m.skip_photo_reason,
      inserted_at: m.inserted_at
    }
  end

  @doc """
  Linked device — phone/tablet/extra browser paired to a user. Never
  includes the raw token (it's exposed exactly once at claim time);
  the FE identifies devices by uuid.
  """
  def linked_device(d) do
    %{
      id: d.id,
      uuid: d.uuid,
      code: render_code(d, "linked_device"),
      label: d.label,
      platform: d.platform,
      user_agent: d.user_agent,
      paired_at: d.paired_at,
      last_seen_at: d.last_seen_at,
      revoked_at: d.revoked_at,
      inserted_at: d.inserted_at,
      updated_at: d.updated_at
    }
  end

  @doc """
  Device pairing code — short-lived bridge between the laptop's
  "Pair new device" dialog and the phone's /pair page. `uuid` is the
  channel topic suffix (`pairing:<uuid>`) the laptop subscribes to so
  it can auto-close the modal when the phone claims.
  """
  def device_pairing_code(p) do
    %{
      uuid: p.uuid,
      code: p.code,
      expires_at: p.expires_at,
      used_at: p.used_at,
      inserted_at: p.inserted_at
    }
  end

  # Minimal item / uom / cell summaries — embedded inside stock_lot
  # so the list endpoint doesn't need a second fetch on the FE side.
  defp item_summary(i) do
    %{
      id: i.id,
      uuid: i.uuid,
      code: render_code(i, "item"),
      name: i.name,
      item_type: i.item_type,
      external_sku: i.external_sku,
      # Surface the item's compliance + storage flags so the lot
      # detail page can render handling chips (requires_coa,
      # allergen_*, requires_cold_chain, etc.) without a second
      # round-trip to the items API.
      compliance_status: i.compliance_status,
      storage_tags: i.storage_tags || []
    }
  end

  defp uom_summary(u) do
    %{
      id: u.id,
      uuid: u.uuid,
      code: render_code(u, "unit_of_measurement"),
      symbol: u.symbol,
      name: u.name
    }
  end

  defp storage_cell_summary(c) do
    loc = if Ecto.assoc_loaded?(c.storage_location), do: c.storage_location, else: nil
    floor = if loc && Ecto.assoc_loaded?(loc.floor), do: loc.floor, else: nil
    warehouse = if floor && Ecto.assoc_loaded?(floor.warehouse), do: floor.warehouse, else: nil

    %{
      id: c.id,
      uuid: c.uuid,
      ordinal: c.ordinal,
      name: c.name,
      # Cell intent — drives the auto-router. Defaults to "regular"
      # for pre-purpose-migration rows. QC reads this on the lot
      # placement card to confirm a quarantine lot really is sitting
      # in a quarantine cell.
      purpose: c.purpose || "regular",
      # Render the company's configured numbering format (e.g.
      # CELL00011) so the FE can display the code instead of the
      # often-empty `name` column. System cells get nil so the FE
      # knows to render the operator-facing "Holding Room" label
      # instead.
      code:
        if(c.system_kind, do: nil, else: render_code(c, "storage_cell")),
      system_kind: c.system_kind,
      storage_location_id: c.storage_location_id,
      storage_location:
        loc &&
          %{
            id: loc.id,
            uuid: loc.uuid,
            name: loc.name,
            code: render_code(loc, "storage_location"),
            system_kind: loc.system_kind
          },
      floor: floor && %{id: floor.id, uuid: floor.uuid, name: floor.name, system_kind: floor.system_kind},
      warehouse: warehouse && %{id: warehouse.id, uuid: warehouse.uuid, name: warehouse.name}
    }
  end

  defp preloaded_or_nil(record, field, shape_fn) do
    case Map.get(record, field) do
      %Ecto.Association.NotLoaded{} -> nil
      nil -> nil
      value -> shape_fn.(value)
    end
  end

  defp preloaded_or_empty(record, field) do
    case Map.get(record, field) do
      %Ecto.Association.NotLoaded{} -> []
      nil -> []
      list when is_list(list) -> list
    end
  end

  defp sum_decimal(items, getter) do
    Enum.reduce(items, Decimal.new(0), fn item, acc ->
      case getter.(item) do
        nil -> acc
        %Decimal{} = d -> Decimal.add(acc, d)
        n when is_integer(n) -> Decimal.add(acc, Decimal.new(n))
      end
    end)
  end

  @doc """
  Public wrapper around the internal `render_code/2` so callers that
  shape their own payloads (e.g. the role controller's `defp payload/1`)
  can render display codes the same way every other shaper does.
  """
  def render_entity_code(entity, entity_key), do: render_code(entity, entity_key)

  ## ----- code rendering --------------------------------------------

  # Resolve the Company once per request and cache it in the process
  # dictionary. Phoenix gives each request its own process so the
  # cache scope is per-request — no cross-request leakage.
  defp current_company do
    case Process.get(:cached_payload_company) do
      nil ->
        company = Backend.Companies.current()
        Process.put(:cached_payload_company, company)
        company

      company ->
        company
    end
  end

  def render_code(%{id: id}, entity_key) when is_integer(id) do
    case current_company() do
      nil -> nil
      company -> Numbering.render(id, company, entity_key)
    end
  end

  def render_code(_entity, _entity_key), do: nil

  # Renders the numbering code (e.g. "L00123") for the MO's target
  # output lot without a preload. Falls back to nil when the MO has
  # no produced_lot_id (never reserved, or reserved lot has since
  # been released via delete).
  defp mo_target_lot_code(%Backend.Production.ManufacturingOrder{produced_lot_id: nil}), do: nil

  defp mo_target_lot_code(%Backend.Production.ManufacturingOrder{produced_lot_id: id})
       when is_integer(id) do
    render_code(%{id: id}, "stock_lot")
  end

  defp mo_target_lot_code(_), do: nil

  # ============================================================
  # Final Product Release payloads — BRCGS Issue 9 § 5.6
  # ============================================================

  def production_final_release(%Backend.Production.FinalRelease{} = r) do
    %{
      uuid: r.uuid,
      status: r.status,
      notes: r.notes,
      hold_reason: r.hold_reason,
      reject_reason: r.reject_reason,
      releaser_id: r.releaser_id,
      releaser: actor(r, :releaser),
      releaser_signed_at: r.releaser_signed_at,
      approver_id: r.approver_id,
      approver: actor(r, :approver),
      approver_signed_at: r.approver_signed_at,
      finalized_at: r.finalized_at,
      finalized_by: actor(r, :finalized_by),
      manufacturing_order:
        case r.manufacturing_order do
          %Backend.Production.ManufacturingOrder{} = mo ->
            %{
              id: mo.id,
              uuid: mo.uuid,
              code: render_code(mo, "manufacturing_order"),
              quantity: decimal_to_string(mo.quantity),
              status: mo.status,
              # Informational — the FE routing card gates the 3PL
              # option off ``is_customer_sample_fulfilment`` below
              # (customer-paid samples ship direct regardless of
              # what ``project_type`` was derived to). Kept for
              # observability + backward compat with FE callers
              # that haven't migrated yet.
              project_type: mo.project_type,
              # True when the MO's linked CO carries
              # ``sample_kind = true`` — customer paid for this
              # specific sample kit via the /samples fulfilment
              # queue. Hides the 3PL card + pre-selects direct
              # shipment on the routing UX regardless of MO's
              # derived ``project_type`` (which is unreliable
              # because scientists commonly picked ``trial`` on
              # customer-paid batches pre-fix). Nil-safe: MOs
              # without a CO chain return false. Same rule as
              # output-qc's ``customer_sample_fulfilment?/1``.
              is_customer_sample_fulfilment:
                customer_sample_fulfilment?(mo)
            }

          _ ->
            nil
        end,
      stock_lot: production_final_release_lot_summary(r.stock_lot),
      files:
        case r.files do
          list when is_list(list) -> Enum.map(list, &production_final_release_file/1)
          _ -> []
        end,
      required_file_kinds: Backend.Production.FinalReleases.required_file_kinds(),
      # Custom-formulation COs defer the 3PL vs shipment decision to
      # the customer via the portal. Both the CO uuid (needed to hit
      # the Approve / Decline endpoints) and the current request
      # state travel with the release payload so the FE can render
      # the RoutingRequestCard without an extra fetch.
      customer_order_uuid: final_release_customer_order_uuid(r.manufacturing_order),
      customer_routing_request: final_release_routing_request(r.manufacturing_order),
      inserted_at: r.inserted_at,
      updated_at: r.updated_at
    }
  end

  def production_final_release(_), do: nil

  defp final_release_customer_order_uuid(nil), do: nil

  defp final_release_customer_order_uuid(%Backend.Production.ManufacturingOrder{
         customer_order_line_id: nil
       }),
       do: nil

  defp final_release_customer_order_uuid(%Backend.Production.ManufacturingOrder{
         customer_order_line_id: line_id
       })
       when is_integer(line_id) do
    import Ecto.Query, only: [from: 2]

    Backend.Repo.one(
      from col in Backend.CustomerOrders.CustomerOrderLine,
        join: co in Backend.CustomerOrders.CustomerOrder,
        on: co.id == col.customer_order_id,
        where: col.id == ^line_id,
        select: co.uuid,
        limit: 1
    )
  end

  defp final_release_routing_request(nil), do: nil

  defp final_release_routing_request(%Backend.Production.ManufacturingOrder{
         customer_order_line_id: nil
       }),
       do: nil

  defp final_release_routing_request(%Backend.Production.ManufacturingOrder{
         customer_order_line_id: line_id
       })
       when is_integer(line_id) do
    import Ecto.Query, only: [from: 2]

    co =
      Backend.Repo.one(
        from col in Backend.CustomerOrders.CustomerOrderLine,
          join: co in Backend.CustomerOrders.CustomerOrder,
          on: co.id == col.customer_order_id,
          where: col.id == ^line_id,
          select: co,
          limit: 1
      )

    case co do
      nil ->
        nil

      %Backend.CustomerOrders.CustomerOrder{} = customer_order ->
        if Backend.ThreePL.Requests.custom_formulation?(customer_order) do
          request = Backend.ThreePL.Requests.get_for_co(customer_order)
          live_snapshot = Backend.ThreePL.Requests.snapshot_for_co(customer_order)

          case request do
            nil ->
              # No request row yet — surface the custom-formulation
              # marker so the FE hides the operator picker even
              # before the wizard hook fires (edge: viewing a lot
              # in awaiting_release right after Final Release
              # signature, before the next snapshot rebuild).
              %{
                is_custom_formulation: true,
                request: nil,
                current_snapshot: serialize_snapshot_for_payload(live_snapshot)
              }

            %Backend.ThreePL.RoutingRequest{} = req ->
              %{
                is_custom_formulation: true,
                request: %{
                  uuid: req.uuid,
                  state: req.state,
                  customer_choice: req.customer_choice,
                  team_decision_reason: req.team_decision_reason,
                  customer_chose_at: req.customer_chose_at,
                  team_reviewed_at: req.team_reviewed_at,
                  frozen_snapshot: req.estimate_snapshot
                },
                current_snapshot: serialize_snapshot_for_payload(live_snapshot)
              }
          end
        else
          nil
        end
    end
  end

  defp serialize_snapshot_for_payload(nil), do: nil

  defp serialize_snapshot_for_payload(snap) do
    %{
      "required_m3" => decimal_to_string(snap.required_m3),
      "free_m3" => decimal_to_string(snap.free_m3),
      "capacity_ok" => snap.capacity_ok,
      "rate_per_m3_per_day" => decimal_to_string(snap.rate_per_m3_per_day),
      "estimated_days" => snap.estimated_days,
      "estimated_daily_charge" => decimal_to_string(snap.estimated_daily_charge),
      "estimated_period_charge" => decimal_to_string(snap.estimated_period_charge),
      "currency_code" => snap.currency_code
    }
  end

  def production_final_release_file(%Backend.Production.FinalReleaseFile{} = f) do
    %{
      uuid: f.uuid,
      kind: f.kind,
      filename: f.filename,
      mime: f.mime,
      byte_size: f.byte_size,
      uploaded_at: f.inserted_at,
      uploaded_by: actor(f, :uploaded_by)
    }
  end

  def production_final_release_file(_), do: nil

  # =========================================================================
  # Shipments (outbound dispatch record — BRCGS Issue 9 § 5.4.6)
  # =========================================================================

  def shipment(%Backend.Shipments.Shipment{} = s) do
    company = Backend.Companies.current()
    dwell = shipment_dispatch_dwell(s, company)

    %{
      id: s.id,
      uuid: s.uuid,
      status: s.status,
      qty: decimal_to_string(s.qty),
      recipient_name: s.recipient_name,
      ship_to_address: s.ship_to_address,
      ship_to_country: s.ship_to_country,
      carrier: s.carrier,
      vehicle_registration: s.vehicle_registration,
      driver_name: s.driver_name,
      consignment_note_ref: s.consignment_note_ref,
      tracking_number: s.tracking_number,
      seal_number: s.seal_number,
      temperature_c: decimal_to_string(s.temperature_c),
      planned_ship_at: s.planned_ship_at,
      notes: s.notes,
      loading_photo_url: s.loading_photo_url,
      customer: shipment_customer(s.customer),
      customer_order: shipment_customer_order(s.customer_order),
      stock_lot: shipment_lot_summary(s.stock_lot),
      # Truck-arrival checklist (BRCGS Issue 9 § 5.4.6). All five must
      # be `true` before `confirm_pickup` accepts the flip.
      packaging_intact: s.packaging_intact,
      labels_verified: s.labels_verified,
      vehicle_clean_suitable: s.vehicle_clean_suitable,
      transport_condition_acceptable: s.transport_condition_acceptable,
      dispatch_approved: s.dispatch_approved,
      pickup_files: shipment_pickup_files(s),
      # Delivery confirmation — filled by the customer-facing team
      # once the POD comes back. `delivered_by` is a distinct actor
      # from `picked_up_by` because different people sign these events.
      delivered_at: s.delivered_at,
      delivered_by: actor(s, :delivered_by),
      recipient_signatory: s.recipient_signatory,
      delivery_notes: s.delivery_notes,
      delivery_files: shipment_delivery_files(s),
      # Dispatch-cell dwell + estimated carrying cost. `nil` when the
      # lot has never landed in a dispatch cell. Consumed by the
      # "Sitting in dispatch since…" banner on the shipment detail
      # page. Rate is the company's 3PL storage rate reused as a
      # proxy for own-stock carrying cost (see Backend.Shipments).
      dispatch_dwell: dwell,
      # Multi-visit pickup totals + timeline. ``picked_up_qty`` +
      # ``remaining_qty`` power the FE progress bar; ``pickup_events``
      # renders the per-visit history with per-event checklist +
      # photos. Standard commercial single-visit shipments end up with
      # a single event in this list — the shape is uniform whether
      # the truck came once or five times.
      picked_up_qty: decimal_to_string(Backend.Shipments.picked_up_qty(s)),
      remaining_qty: decimal_to_string(Backend.Shipments.remaining_qty(s)),
      pickup_events: shipment_pickup_events(s),
      created_at: s.inserted_at,
      created_by: actor(s, :created_by),
      ready_at: s.ready_at,
      ready_by: actor(s, :ready_by),
      picked_up_at: s.picked_up_at,
      picked_up_by: actor(s, :picked_up_by),
      cancelled_at: s.cancelled_at,
      cancelled_by: actor(s, :cancelled_by),
      cancel_reason: s.cancel_reason,
      updated_at: s.updated_at
    }
  end

  defp shipment_pickup_events(%Backend.Shipments.Shipment{} = s) do
    case s.pickup_events do
      list when is_list(list) ->
        Enum.map(list, &shipment_pickup_event(&1, s))

      _ ->
        # Not preloaded — do a targeted fetch. Cheaper than blanket
        # preloading on every shipment payload path (list tables etc).
        Backend.Shipments.list_pickup_events(s)
        |> Enum.map(&shipment_pickup_event(&1, s))
    end
  end

  def shipment_pickup_event(
        %Backend.Shipments.ShipmentPickupEvent{} = e,
        %Backend.Shipments.Shipment{} = shipment
      ) do
    %{
      uuid: e.uuid,
      shipment_id: shipment.id,
      shipment_uuid: shipment.uuid,
      qty: decimal_to_string(e.qty),
      picked_up_at: e.picked_up_at,
      picked_up_by: actor(e, :picked_up_by),
      driver_name: e.driver_name,
      vehicle_registration: e.vehicle_registration,
      consignment_note_ref: e.consignment_note_ref,
      tracking_number: e.tracking_number,
      seal_number: e.seal_number,
      temperature_c: decimal_to_string(e.temperature_c),
      notes: e.notes,
      packaging_intact: e.packaging_intact,
      labels_verified: e.labels_verified,
      vehicle_clean_suitable: e.vehicle_clean_suitable,
      transport_condition_acceptable: e.transport_condition_acceptable,
      dispatch_approved: e.dispatch_approved,
      photos:
        case e.photos do
          list when is_list(list) ->
            Enum.map(list, &shipment_pickup_file(&1, shipment))

          _ ->
            []
        end,
      # Per-event POD stamp. ``nil`` until the customer / staff
      # confirms delivery for THIS event. Each event delivers
      # independently — a Tuesday truck's POD lives here, not on
      # the shipment row.
      delivered_at: e.delivered_at,
      delivered_by: actor(e, :delivered_by),
      recipient_signatory: e.recipient_signatory,
      delivery_notes: e.delivery_notes,
      delivery_files:
        case e.delivery_files do
          list when is_list(list) ->
            Enum.map(list, &shipment_delivery_file(&1, shipment))

          _ ->
            []
        end,
      inserted_at: e.inserted_at
    }
  end

  def shipment_pickup_event(_, _), do: nil

  def shipment(_), do: nil

  @doc """
  Slim row for the mobile pickup queue (``/m/dispatch``). Skips the
  heavy dwell / files / actor preloads that the detail page needs —
  the operator only sees code / recipient / planned time / lot code
  / quantity / a customer name before tapping through.

  Keep the payload flat + primitive-only so page fetches stay small
  even on a warehouse with hundreds of ready shipments queued up
  ahead of a busy dispatch shift.
  """
  def shipment_pickup_row(%Backend.Shipments.Shipment{} = s) do
    lot = if is_map(s.stock_lot), do: s.stock_lot, else: nil
    item = if lot && is_map(lot.item), do: lot.item, else: nil
    unit = if lot && is_map(lot.unit_of_measurement), do: lot.unit_of_measurement, else: nil
    customer = if is_map(s.customer), do: s.customer, else: nil

    %{
      uuid: s.uuid,
      code: render_code(s, "shipment"),
      recipient_name: s.recipient_name,
      ship_to_city: extract_city(s.ship_to_address),
      ship_to_country: s.ship_to_country,
      planned_ship_at: s.planned_ship_at,
      qty: decimal_to_string(s.qty),
      unit_symbol: unit && Map.get(unit, :symbol),
      lot_code: lot && render_code(lot, "stock_lot"),
      item_name: item && item.name,
      customer_name: customer && customer.name
    }
  end

  def shipment_pickup_row(_), do: nil

  # Ship-to address is a freeform textarea. For the mobile row we
  # want the last non-postcode line — usually the city — so the
  # operator scans "London" not the full three-line block. Falls
  # back to the whole string when we can't identify a city cleanly.
  defp extract_city(nil), do: nil

  defp extract_city(addr) when is_binary(addr) do
    lines =
      addr
      |> String.split(~r/[\r\n,]/, trim: true)
      |> Enum.map(&String.trim/1)
      |> Enum.reject(&(&1 == ""))

    case lines do
      [] -> nil
      [only] -> only
      _ -> Enum.at(lines, -2) || List.last(lines)
    end
  end

  defp extract_city(_), do: nil

  @doc "Row shape for a truck-arrival photo."
  def shipment_pickup_file(%Backend.Shipments.ShipmentPickupFile{} = f, %Backend.Shipments.Shipment{} = shipment) do
    %{
      uuid: f.uuid,
      filename: f.filename,
      mime: f.mime,
      byte_size: f.byte_size,
      uploaded_at: f.inserted_at,
      uploaded_by: file_actor(f.uploaded_by),
      url: "/api/shipments/#{shipment.uuid}/pickup-files/#{f.uuid}/blob"
    }
  end

  def shipment_pickup_file(_, _), do: nil

  defp shipment_pickup_files(%Backend.Shipments.Shipment{pickup_files: files} = s) when is_list(files) do
    Enum.map(files, &shipment_pickup_file(&1, s))
  end

  defp shipment_pickup_files(_), do: []

  @doc "Row shape for a delivery-confirmation attachment (POD / photo)."
  def shipment_delivery_file(%Backend.Shipments.ShipmentDeliveryFile{} = f, %Backend.Shipments.Shipment{} = shipment) do
    %{
      uuid: f.uuid,
      filename: f.filename,
      mime: f.mime,
      byte_size: f.byte_size,
      uploaded_at: f.inserted_at,
      uploaded_by: file_actor(f.uploaded_by),
      url: "/api/shipments/#{shipment.uuid}/delivery-files/#{f.uuid}/blob"
    }
  end

  def shipment_delivery_file(_, _), do: nil

  defp shipment_delivery_files(%Backend.Shipments.Shipment{delivery_files: files} = s) when is_list(files) do
    Enum.map(files, &shipment_delivery_file(&1, s))
  end

  defp shipment_delivery_files(_), do: []

  defp file_actor(%Backend.Accounts.User{} = u), do: %{uuid: u.uuid, name: u.name}
  defp file_actor(_), do: nil

  defp shipment_dispatch_dwell(
         %Backend.Shipments.Shipment{stock_lot: %Backend.Stock.Lot{} = lot},
         company
       ) do
    rate = company && company.three_pl_rate_per_m3_per_day

    case Backend.Shipments.dispatch_dwell_summary(lot, rate) do
      nil ->
        nil

      %{
        arrived_at: at,
        dwell_seconds: secs,
        volume_m3: vol,
        estimated_storage_cost: cost
      } ->
        %{
          arrived_at: at,
          dwell_seconds: secs,
          volume_m3: decimal_to_string(vol),
          estimated_storage_cost: decimal_to_string(cost),
          rate_per_m3_per_day: decimal_to_string(rate)
        }
    end
  end

  defp shipment_dispatch_dwell(_, _), do: nil

  defp shipment_customer(%Backend.Customers.Customer{} = c) do
    %{
      id: c.id,
      uuid: c.uuid,
      name: c.name,
      legal_name: c.legal_name,
      contact_name: c.contact_name,
      legal_address: c.legal_address,
      country_code: c.country_code
    }
  end

  defp shipment_customer(_), do: nil

  defp shipment_customer_order(%Backend.CustomerOrders.CustomerOrder{} = co) do
    %{
      id: co.id,
      uuid: co.uuid,
      status: co.status,
      # Portal-profile delivery address, mirrored from NPD's Customer
      # row via the sync. Feeds the shipment form's "Fill from order"
      # autofill so the coordinator doesn't retype what the customer
      # already saved on /portal/settings.
      delivery_address: co.delivery_address
    }
  end

  defp shipment_customer_order(_), do: nil

  defp shipment_lot_summary(%Backend.Stock.Lot{} = lot) do
    placement =
      case lot.placements do
        list when is_list(list) ->
          Enum.find(list, fn p ->
            p.storage_cell && p.qty &&
              Decimal.compare(p.qty, Decimal.new(0)) == :gt
          end)

        _ ->
          nil
      end

    cell = placement && placement.storage_cell
    location = cell && cell.storage_location
    floor = location && location.floor
    warehouse = floor && floor.warehouse

    %{
      id: lot.id,
      uuid: lot.uuid,
      code: render_code(lot, "stock_lot"),
      supplier_batch_no: lot.supplier_batch_no,
      qty_received: decimal_to_string(lot.qty_received),
      expiry_at: lot.expiry_at,
      ownership_kind: lot.ownership_kind,
      item: shipment_item_summary(lot.item),
      unit_symbol: lot.unit_of_measurement && lot.unit_of_measurement.symbol,
      bailee_customer: shipment_customer(lot.bailee_customer),
      placement:
        cell &&
          %{
            cell_uuid: cell.uuid,
            cell_name: cell.name,
            cell_code: render_code(cell, "storage_cell"),
            cell_purpose: cell.purpose,
            location_name: location && location.name,
            location_code: location && location.code,
            floor_name: floor && floor.name,
            warehouse_name: warehouse && warehouse.name
          }
    }
  end

  defp shipment_lot_summary(_), do: nil

  defp shipment_item_summary(%Backend.Items.Item{} = it) do
    %{id: it.id, uuid: it.uuid, name: it.name, item_type: it.item_type}
  end

  defp shipment_item_summary(_), do: nil

  defp production_final_release_lot_summary(%Backend.Stock.Lot{} = lot) do
    %{
      id: lot.id,
      uuid: lot.uuid,
      code: render_code(lot, "stock_lot"),
      status: lot.status,
      qty_received: decimal_to_string(lot.qty_received),
      expiry_at: lot.expiry_at,
      item:
        case lot.item do
          %Backend.Items.Item{} = it ->
            %{id: it.id, uuid: it.uuid, name: it.name, item_type: it.item_type}

          _ ->
            nil
        end,
      placement: production_final_release_lot_placement(lot.placements),
      # 3PL routing snapshot. `ownership_kind = bailee` implies
      # routed_to_3pl fired; `routing_choice = "shipment"` marks the
      # lot routed to dispatch. Both fields are nil until the release
      # is positively finalised and the operator hits the wizard's
      # routing step.
      ownership_kind: lot.ownership_kind,
      bailee_customer:
        case lot.bailee_customer do
          %Backend.Customers.Customer{} = c ->
            %{id: c.id, uuid: c.uuid, name: c.name}

          _ ->
            nil
        end,
      bailee_routed_at: lot.bailee_routed_at,
      routing_choice: latest_routing_choice(lot),
      # Package dimensions — the routing form needs them to render the
      # capacity chip / warn if they're missing. Nullable on legacy
      # rows, populated on new receives.
      package_length_mm: lot.package_length_mm,
      package_width_mm: lot.package_width_mm,
      package_height_mm: lot.package_height_mm,
      units_per_package: lot.units_per_package
    }
  end

  # Most recent routed_to_3pl / routed_to_shipment event for the lot,
  # translated back to a wizard-side `"three_pl" | "shipment" | nil`.
  # One extra hit per release fetch — acceptable since the routing
  # question only lives on this page.
  defp latest_routing_choice(%Backend.Stock.Lot{id: lot_id}) do
    import Ecto.Query

    row =
      from(e in Backend.Stock.LotEvent,
        where:
          e.stock_lot_id == ^lot_id and
            e.kind in ["routed_to_3pl", "routed_to_shipment"],
        order_by: [desc: e.occurred_at, desc: e.id],
        select: e.kind,
        limit: 1
      )
      |> Backend.Repo.one()

    case row do
      "routed_to_3pl" -> "three_pl"
      "routed_to_shipment" -> "shipment"
      _ -> nil
    end
  end

  defp production_final_release_lot_summary(_), do: nil

  defp production_final_release_lot_placement([%Backend.Stock.Placement{} = p | _]) do
    cell = p.storage_cell

    if match?(%Backend.Warehouses.StorageCell{}, cell) do
      loc = cell.storage_location
      floor = loc && loc.floor
      warehouse = floor && floor.warehouse

      %{
        cell_uuid: cell.uuid,
        cell_name: cell.name,
        # Ordinal is the 0-based shelf level inside a rack. Only useful
        # when `cell_name` is nil — the FE derives "Level 1" style
        # display from it so the release list doesn't render "— · —".
        cell_ordinal: cell.ordinal,
        cell_purpose: cell.purpose,
        location:
          case loc do
            %Backend.Warehouses.StorageLocation{} ->
              %{uuid: loc.uuid, name: loc.name, code: loc.code}

            _ ->
              nil
          end,
        floor:
          case floor do
            %Backend.Warehouses.Floor{} -> %{uuid: floor.uuid, name: floor.name}
            _ -> nil
          end,
        warehouse:
          case warehouse do
            %Backend.Warehouses.Warehouse{} -> %{uuid: warehouse.uuid, name: warehouse.name}
            _ -> nil
          end
      }
    else
      nil
    end
  end

  defp production_final_release_lot_placement(_), do: nil

  # =========================================================================
  # My tasks — per-user actionable CTAs across every CO in the pipeline.
  # =========================================================================

  def my_task(%{} = task) do
    %{
      id: task.id,
      entity_type: Map.get(task, :entity_type, "customer_order"),
      co_uuid: task.co_uuid,
      co_code: task.co_code,
      customer_name: task.customer_name,
      item_uuid: Map.get(task, :item_uuid),
      item_code: Map.get(task, :item_code),
      item_name: Map.get(task, :item_name),
      phase_key: task.phase_key,
      phase_label: task.phase_label,
      action_code: task.action_code,
      title: task.title,
      detail: task.detail,
      cta: normalise_cta(task.cta),
      due_date: task.due_date,
      updated_at: task.updated_at
    }
  end

  # The OrderWizard emits CTAs with atom keys; some paths hand them
  # back with string keys because they came through a Task or a
  # broadcast. Normalise to atom keys so the FE sees a consistent
  # shape.
  defp normalise_cta(nil), do: nil

  defp normalise_cta(cta) when is_map(cta) do
    %{
      label: get(cta, :label),
      kind: get(cta, :kind),
      action: get(cta, :action),
      line_uuid: get(cta, :line_uuid),
      bom_id: get(cta, :bom_id),
      mo_uuid: get(cta, :mo_uuid),
      href: get(cta, :href),
      target: get(cta, :target),
      description: get(cta, :description)
    }
  end

  defp get(map, key) do
    Map.get(map, key) || Map.get(map, Atom.to_string(key))
  end

  # ----- equipment ------------------------------------------------

  @doc """
  Equipment unit payload — identity + status + location + assignment
  + cadence fields. Preloads (item, current_cell, assigned_to,
  purchase_order_line) are optional; missing associations render as
  nil rather than crashing.
  """
  def equipment(%Backend.Equipment.Equipment{} = e) do
    %{
      id: e.id,
      uuid: e.uuid,
      code: render_code(e, "equipment"),
      serial_number: e.serial_number,
      manufacturer_serial: e.manufacturer_serial,
      manufacturer: e.manufacturer,
      model: e.model,
      status: e.status,
      unit_cost: e.unit_cost,
      currency: e.currency,
      acquired_at: e.acquired_at,
      warranty_end_at: e.warranty_end_at,
      useful_life_years: e.useful_life_years,
      calibration_frequency_months: e.calibration_frequency_months,
      last_calibrated_at: e.last_calibrated_at,
      next_calibration_at: e.next_calibration_at,
      maintenance_frequency_months: e.maintenance_frequency_months,
      last_maintenance_at: e.last_maintenance_at,
      next_maintenance_at: e.next_maintenance_at,
      retired_at: e.retired_at,
      disposed_at: e.disposed_at,
      notes: e.notes,
      item: preloaded_or_nil(e, :item, &item/1),
      current_cell:
        preloaded_or_nil(e, :current_cell, &equipment_cell_summary/1),
      assigned_to: preloaded_or_nil(e, :assigned_to, &audit_actor/1),
      purchase_order_line:
        preloaded_or_nil(e, :purchase_order_line, &equipment_po_line_summary/1),
      created_by: preloaded_or_nil(e, :created_by, &audit_actor/1),
      inserted_at: e.inserted_at,
      updated_at: e.updated_at
    }
  end

  defp equipment_cell_summary(%Backend.Warehouses.StorageCell{} = cell) do
    %{
      id: cell.id,
      uuid: cell.uuid,
      code: render_code(cell, "storage_cell"),
      name: cell.name
    }
  end

  defp equipment_cell_summary(_), do: nil

  defp equipment_po_line_summary(%Backend.Purchasing.PurchaseOrderLine{} = line) do
    %{
      id: line.id,
      uuid: line.uuid,
      purchase_order_id: line.purchase_order_id
    }
  end

  defp equipment_po_line_summary(_), do: nil

  @doc """
  Lifecycle event for the equipment detail timeline. Same fields as
  the lot event surface: kind + actor + reason + metadata +
  optional cell breadcrumb + optional assignment snapshot.
  """
  def equipment_event(%Backend.Equipment.Event{} = event) do
    %{
      id: event.id,
      uuid: event.uuid,
      kind: event.kind,
      actor: preloaded_or_nil(event, :actor, &audit_actor/1),
      actor_kind: event.actor_kind,
      reason: event.reason,
      metadata: event.metadata,
      from_cell: preloaded_or_nil(event, :from_cell, &equipment_cell_summary/1),
      to_cell: preloaded_or_nil(event, :to_cell, &equipment_cell_summary/1),
      assigned_to_user: preloaded_or_nil(event, :assigned_to_user, &audit_actor/1),
      occurred_at: event.occurred_at,
      inserted_at: event.inserted_at
    }
  end

  @doc """
  Equipment file — mirrors `po_file` shape. Includes a serve URL
  scoped under the equipment uuid so links only resolve under their
  owning record.
  """
  def equipment_file(%Backend.Equipment.File{} = f) do
    %{
      id: f.id,
      uuid: f.uuid,
      equipment_id: f.equipment_id,
      kind: f.kind,
      filename: f.filename,
      mime: f.mime,
      byte_size: f.byte_size,
      uploaded_by: preloaded_or_nil(f, :uploaded_by, &audit_actor/1),
      inserted_at: f.inserted_at,
      updated_at: f.updated_at
    }
  end

  @doc """
  Integration token — machine-to-machine bearer credential. Never
  echoes the raw token (that only surfaces once on mint via the
  controller's create response); the `prefix` is safe to display.
  """
  def integration_token(%Backend.Accounts.IntegrationToken{} = t) do
    %{
      id: t.id,
      uuid: t.uuid,
      name: t.name,
      prefix: t.token_prefix,
      scopes: t.scopes,
      is_active: t.is_active,
      last_used_at: t.last_used_at,
      revoked_at: t.revoked_at,
      revoke_reason: t.revoke_reason,
      revoked_by: actor(t, :revoked_by),
      created_by: actor(t, :created_by),
      inserted_at: t.inserted_at,
      updated_at: t.updated_at
    }
  end

  # ============================================================
  # HR — employees, wages, reputation events
  # ============================================================

  @doc """
  Full employee payload for the detail page. Wage / reputation
  timelines are fetched via sibling endpoints so this stays cheap;
  we do embed the currently effective wage row (or nil) so the
  ledger doesn't need a fan-out for the "current rate" column.
  """
  def hr_employee(%Backend.HR.Employee{} = e) do
    current = Backend.HR.current_wage(e)

    %{
      id: e.id,
      uuid: e.uuid,
      code: render_code(e, "employee") || e.employee_number,
      employee_number: e.employee_number,
      external_id: e.external_id,
      full_name: e.full_name,
      preferred_name: e.preferred_name,
      email: e.email,
      phone: e.phone,
      hire_date: e.hire_date,
      termination_date: e.termination_date,
      is_active: e.is_active,
      is_qa: e.is_qa,
      reputation_score: e.reputation_score,
      has_kiosk_pin: not is_nil(e.kiosk_pin_hash),
      current_wage:
        case current do
          %Backend.HR.EmployeeWage{} = w -> hr_employee_wage(w)
          _ -> nil
        end,
      company_id: e.company_id,
      user_id: e.user_id,
      user:
        case Map.get(e, :user) do
          %Backend.Accounts.User{} = u -> audit_actor(u)
          _ -> nil
        end,
      created_by: actor(e, :created_by),
      updated_by: actor(e, :updated_by),
      inserted_at: e.inserted_at,
      updated_at: e.updated_at
    }
  end

  @doc """
  Slim summary for the ledger. Same shape the detail payload's
  `current_wage` uses — the FE can point column renderers at either
  without a second type.
  """
  def hr_employee_summary(%Backend.HR.Employee{} = e) do
    current = Backend.HR.current_wage(e)

    %{
      id: e.id,
      uuid: e.uuid,
      code: render_code(e, "employee") || e.employee_number,
      employee_number: e.employee_number,
      external_id: e.external_id,
      full_name: e.full_name,
      preferred_name: e.preferred_name,
      email: e.email,
      hire_date: e.hire_date,
      is_active: e.is_active,
      is_qa: e.is_qa,
      reputation_score: e.reputation_score,
      current_hourly_rate:
        case current do
          %Backend.HR.EmployeeWage{hourly_rate: r} -> decimal_to_string(r)
          _ -> nil
        end,
      current_currency_code:
        case current do
          %Backend.HR.EmployeeWage{currency_code: c} -> c
          _ -> nil
        end,
      inserted_at: e.inserted_at,
      updated_at: e.updated_at
    }
  end

  @doc """
  Wage-history row payload. Decimals are stringified so the JSON stays
  precise; the FE renders via `formatCompanyMoney` from the company
  settings so the display honours locale.
  """
  def hr_employee_wage(%Backend.HR.EmployeeWage{} = w) do
    %{
      id: w.id,
      uuid: w.uuid,
      employee_id: w.employee_id,
      effective_from: w.effective_from,
      effective_to: w.effective_to,
      hourly_rate: decimal_to_string(w.hourly_rate),
      currency_code: w.currency_code,
      tax_treatment: w.tax_treatment,
      source_kind: w.source_kind,
      reason: w.reason,
      approved_by: actor(w, :approved_by),
      inserted_at: w.inserted_at,
      updated_at: w.updated_at
    }
  end

  @doc """
  Reputation-event row payload. `resulting_score` is the projection
  the *event's insertion* produced — we approximate it lazily as
  `nil` here because computing it after-the-fact per row would need
  a replay; the current cached score on the employee is enough for
  every rendered surface today. Wire in if / when the timeline card
  needs the walk.
  """
  def hr_employee_reputation_event(%Backend.HR.EmployeeReputationEvent{} = ev) do
    %{
      id: ev.id,
      uuid: ev.uuid,
      employee_id: ev.employee_id,
      session_external_id: ev.session_external_id,
      event_type: ev.event_type,
      score_delta: ev.score_delta,
      reason: ev.reason,
      created_by_user: actor(ev, :created_by_user),
      created_by_employee:
        case Map.get(ev, :created_by_employee) do
          %Backend.HR.Employee{} = e ->
            %{id: e.id, uuid: e.uuid, name: e.full_name}

          _ ->
            nil
        end,
      inserted_at: ev.inserted_at,
      updated_at: ev.updated_at
    }
  end

  @doc """
  Shift-row payload. `employee` is populated only when the caller
  preloaded it (company-wide feed does; per-employee timelines skip
  the redundant nested employee). `duration_seconds` is materialised
  on close so listing pages never need to compute it per row.
  """
  def hr_employee_shift(%Backend.HR.EmployeeShift{} = s) do
    base = %{
      id: s.id,
      uuid: s.uuid,
      employee_id: s.employee_id,
      external_id: s.external_id,
      started_at: s.started_at,
      ended_at: s.ended_at,
      duration_seconds: s.duration_seconds,
      device_id: s.device_id,
      notes: s.notes,
      inserted_at: s.inserted_at,
      updated_at: s.updated_at
    }

    case Map.get(s, :employee) do
      %Backend.HR.Employee{} = e ->
        Map.put(base, :employee, %{id: e.id, uuid: e.uuid, name: e.full_name})

      _ ->
        base
    end
  end
end
