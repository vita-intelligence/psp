defmodule BackendWeb.CompanyController do
  @moduledoc """
  Company singleton endpoints. RBAC-gated:

    * `:show`           → `company.view`
    * `:update`         → `company.edit` (identity card)
    * `:update_locale`  → `company.edit` (locale card)
    * `:update_bag`     → `company.edit` (working hours / holidays /
                          rates / IPs / numbering)
    * `:defaults`       → any authed user (no permission gate). Slim
                          subset every page needs to render org-wide
                          context (timezone the warehouses inherit,
                          locale used to format dates, …). Distinct
                          from `:show` so a user without `company.view`
                          can still open downstream pages that depend
                          on these defaults.

  The shape inside each JSONB bag is validated here (not in the
  Company schema) because each bag has different keys and we want the
  HTTP error messages to be specific to the section being edited.
  """

  use BackendWeb, :controller

  alias Backend.Companies
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "company.view" when action in [:show]

  plug RequirePermission,
       "company.edit"
       when action in [:update, :update_locale, :update_bag]

  action_fallback BackendWeb.FallbackController

  @bag_fields ~w(working_hours holidays currency_rates allowed_ips numbering_formats)

  def show(conn, _params) do
    json(conn, %{company: Payloads.company(Companies.current())})
  end

  def defaults(conn, _params) do
    json(conn, %{defaults: Payloads.company_defaults(Companies.current())})
  end

  def update(conn, params) do
    case Companies.update_identity(Companies.current(), params) do
      {:ok, company} ->
        json(conn, %{company: Payloads.company(company)})

      {:error, %Ecto.Changeset{} = cs} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "validation_failed",
            "Please correct the highlighted fields.",
            Errors.changeset_fields(cs)
          )
        )
    end
  end

  def update_locale(conn, params) do
    case Companies.update_locale(Companies.current(), params) do
      {:ok, company} ->
        json(conn, %{company: Payloads.company(company)})

      {:error, %Ecto.Changeset{} = cs} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "validation_failed",
            "Please correct the highlighted fields.",
            Errors.changeset_fields(cs)
          )
        )
    end
  end

  def update_bag(conn, %{"field" => field, "value" => value})
      when field in @bag_fields do
    case Companies.update_bag(Companies.current(), String.to_atom(field), value) do
      {:ok, company} ->
        json(conn, %{company: Payloads.company(company)})

      {:error, %Ecto.Changeset{} = cs} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "validation_failed",
            "Couldn't save those settings.",
            Errors.changeset_fields(cs)
          )
        )
    end
  end

  def update_bag(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(
      Errors.payload(
        "bad_request",
        "Expected `field` (one of #{Enum.join(@bag_fields, ", ")}) and `value`."
      )
    )
  end
end
