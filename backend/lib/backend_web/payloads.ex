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
      allowed_ips: company.allowed_ips,
      numbering_formats: company.numbering_formats,
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
      generic_place_name: company.generic_place_name
    }
  end

  def warehouse(w) do
    %{
      id: w.id,
      uuid: w.uuid,
      code: render_code(w, "warehouse"),
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
      is_active: i.is_active,
      inserted_at: i.inserted_at,
      updated_at: i.updated_at,
      created_by: actor(i, :created_by),
      updated_by: actor(i, :updated_by)
    }

    # Sub-tables are only included when preloaded — list endpoints
    # never load them (saves a join per row), show endpoints do.
    base
    |> add_optional(:raw_material_compliance, i.raw_material_compliance, &raw_material_compliance/1)
    |> add_optional(:raw_material_risk, i.raw_material_risk, &raw_material_risk/1)
    |> add_optional(:finished_product_spec, i.finished_product_spec, &finished_product_spec/1)
    |> add_optional(:packaging_compliance, i.packaging_compliance, &packaging_compliance/1)
    |> add_optional(:certificate_attachments, i.certificate_attachments, fn list ->
      Enum.map(list, &item_certificate/1)
    end)
    |> add_optional(:images, i.images, fn list -> Enum.map(list, &item_image/1) end)
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

  def packaging_compliance(p) do
    %{
      material: p.material,
      food_contact_compliant: p.food_contact_compliant,
      food_contact_declaration_url: p.food_contact_declaration_url,
      recyclability_code: p.recyclability_code,
      migration_test_url: p.migration_test_url,
      migration_test_expires_at: p.migration_test_expires_at,
      inserted_at: p.inserted_at,
      updated_at: p.updated_at
    }
  end

  def finished_product_spec(s) do
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
      spec_document_url: s.spec_document_url,
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

  def raw_material_compliance(c) do
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
      spec_document_url: c.spec_document_url,
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
      notes: c.notes,
      inserted_at: c.inserted_at,
      updated_at: c.updated_at,
      created_by: actor(c, :created_by),
      updated_by: actor(c, :updated_by)
    }
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
