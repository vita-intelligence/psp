defmodule BackendWeb.Payloads do
  @moduledoc """
  Shared payload shapers — keeps every controller emitting the same
  field set for users and companies so the frontend types are stable.
  """

  alias Backend.RBAC

  def user(user) do
    %{
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      is_active: user.is_active,
      confirmed_at: user.confirmed_at,
      inserted_at: user.inserted_at,
      company_id: user.company_id,
      roles: roles_for(user),
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

  defp roles_for(user) do
    case user.roles do
      %Ecto.Association.NotLoaded{} -> []
      roles -> Enum.map(roles, &%{id: &1.id, slug: &1.slug, name: &1.name})
    end
  end
end
