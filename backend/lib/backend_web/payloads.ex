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
