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
      inserted_at: company.inserted_at,
      updated_at: company.updated_at
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
      default_pickup_window_hours: company.default_pickup_window_hours
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

  # Returns the live blocker list ONLY when the per-type subtables are
  # loaded (show endpoint). On list endpoints the row's
  # `compliance_status` column is authoritative — we don't run the
  # validator per row, that'd cost a preload per item.
  defp compliance_blockers(%Backend.Items.Item{} = i) do
    has_subtables? =
      match?(%Backend.Items.RawMaterialCompliance{}, i.raw_material_compliance) or
        match?(%Backend.Items.RawMaterialRiskAssessment{}, i.raw_material_risk) or
        match?(%Backend.Items.FinishedProductSpec{}, i.finished_product_spec) or
        match?(%Backend.Items.PackagingCompliance{}, i.packaging_compliance) or
        i.item_type == "semi_finished"

    if has_subtables? do
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
      inserted_at: i.inserted_at,
      updated_at: i.updated_at,
      created_by: actor(i, :created_by),
      updated_by: actor(i, :updated_by)
    }

    # Sub-tables are only included when preloaded — list endpoints
    # never load them (saves a join per row), show endpoints do.
    base
    |> add_optional(:raw_material_compliance, i.raw_material_compliance,
      &raw_material_compliance(&1, i))
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
      delivery_address: co.delivery_address,
      customer_reference: co.customer_reference,
      notes: co.notes,
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
      stock_uom: maybe_uom_compact(Map.get(i, :stock_uom))
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
      updated_at: b.updated_at
    }
  end

  def bom_summary(_), do: nil

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
      instances: g.instances,
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
      instances: g.instances,
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
      inserted_at: w.inserted_at,
      updated_at: w.updated_at
    }
  end

  def workstation_summary(_), do: nil

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

    %{
      id: mo.id,
      uuid: mo.uuid,
      code: render_code(mo, "manufacturing_order"),
      status: mo.status,
      revision: mo.revision,
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
      created_by: actor(mo, :created_by),
      updated_by: actor(mo, :updated_by),
      inserted_at: mo.inserted_at,
      updated_at: mo.updated_at
    }
  end

  def manufacturing_order(_), do: nil

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
    lines =
      case bom.lines do
        %Ecto.Association.NotLoaded{} ->
          Backend.Repo.preload(bom, lines: [:part, :unit_of_measurement]).lines

        list when is_list(list) ->
          list
      end
      |> Enum.sort_by(& &1.sort_order)

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
            has_open_po
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
          bookings: Enum.map(line_bookings, &mo_booking/1),
          pending_from_sub_mos: Enum.map(pending_children, &mo_pending_sub_mo_row/1),
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

    materials_total =
      if Decimal.equal?(total, Decimal.new("0")), do: nil, else: total

    {parts, materials_total}
  end

  defp mo_parts_breakdown(_), do: {[], nil}

  # Derive the master-row badge state from booked + sub-MO pending vs
  # required. `nil` required (no qty on the line) leaves it `unknown`.
  # For completed MOs the badge tells the post-run truth: how much
  # was actually consumed, not what was booked at scheduling time.
  defp coverage_state_for(_status, nil, _booked, _consumed, _pending, _coverage, _has_open_po),
    do: "unknown"

  defp coverage_state_for(
         "completed",
         %Decimal{} = required,
         _booked,
         consumed,
         _pending,
         _coverage,
         _has_open_po
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
         has_open_po
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
  def mo_booking(%Backend.Production.ManufacturingOrderBooking{} = b) do
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
      stock_lot: mo_booking_lot_summary(b.stock_lot),
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

  def mo_booking(_), do: nil

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
  def output_qc_entry(%{lot: %Backend.Stock.Lot{} = lot, mo: mo}) do
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
            pickup_completed_by: actor(mo, :pickup_completed_by)
          }
    }
  end

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
  def closeout_output_lot(%Backend.Stock.Lot{} = lot) do
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
          }
    }
  end

  def closeout_output_lot(_), do: nil

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
  def return_pickup_lot(%Backend.Stock.Lot{} = lot) do
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
      dispatch_cell:
        case placement do
          nil -> nil
          p -> dispatch_cell(p.storage_cell)
        end
    }
  end

  def return_pickup_lot(_), do: nil

  @doc """
  Trolley row — warehouse worker currently holding the lot in flight
  between the dispatch cell and the warehouse rack.
  """
  def return_pick_row(%Backend.Warehouses.ReturnPick{} = pick) do
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

  def return_pick_row(_), do: nil

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
    Enum.find(list, fn p ->
      Decimal.compare(p.qty || Decimal.new(0), Decimal.new(0)) == :gt and
        match?(%Backend.Warehouses.StorageCell{purpose: "dispatch"}, p.storage_cell)
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

  defp mo_booking_lot_summary(%Backend.Stock.Lot{} = lot) do
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
      qty_on_hand: decimal_to_string(qty_on_hand)
    }
  end

  defp mo_booking_lot_summary(_), do: nil

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
      updated_at: l.updated_at
    }
  end

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
  def comment(c) do
    %{
      id: c.id,
      uuid: c.uuid,
      entity_type: c.entity_type,
      entity_id: c.entity_id,
      body: c.body,
      visibility: c.visibility,
      parent_comment_id: c.parent_comment_id,
      mentioned_user_ids: c.mentioned_user_ids || [],
      edited_at: c.edited_at,
      created_at: c.inserted_at,
      updated_at: c.updated_at,
      author: actor(c, :author)
    }
  end

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

  def raw_material_compliance(c, item \\ nil) do
    %{
      use_as: c.use_as,
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
    placements = preloaded_or_empty(l, :placements)
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

  defp render_code(%{id: id}, entity_key) when is_integer(id) do
    case current_company() do
      nil -> nil
      company -> Numbering.render(id, company, entity_key)
    end
  end

  defp render_code(_entity, _entity_key), do: nil
end
