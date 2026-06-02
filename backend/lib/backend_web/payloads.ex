defmodule BackendWeb.Payloads do
  @moduledoc """
  Shared payload shapers — keeps every controller emitting the same
  field set for users and companies so the frontend types are stable.
  """

  alias Backend.RBAC

  def user(user) do
    %{
      id: user.id,
      uuid: user.uuid,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      is_active: user.is_active,
      is_admin: Map.get(user, :is_admin, false),
      hourly_wage: user.hourly_wage,
      confirmed_at: user.confirmed_at,
      inserted_at: user.inserted_at,
      company_id: user.company_id,
      permissions: RBAC.effective_permissions(user)
    }
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
      updated_at: w.updated_at
    }
  end

end
