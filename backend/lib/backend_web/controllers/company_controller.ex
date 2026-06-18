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
  alias Backend.Workers.CurrencyRatesPull
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "company.view" when action in [:show]

  plug RequirePermission,
       "company.edit"
       when action in [
              :update,
              :update_locale,
              :update_bag,
              :update_warehouse_pickup,
              :update_currency_rates_auto_pull,
              :refresh_currency_rates_now
            ]

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

  def update_warehouse_pickup(conn, params) do
    case Companies.update_warehouse_pickup(Companies.current(), params) do
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

  # Toggle whether the ECB cron is allowed to overwrite the rates bag.
  # When flipped to false, the FE's manual currency-rates form
  # reactivates; when flipped back to true, the next 08:00 UTC tick
  # repopulates from the ECB feed.
  def update_currency_rates_auto_pull(conn, %{"enabled" => enabled})
      when is_boolean(enabled) do
    actor = conn.assigns[:current_user]

    case Companies.update_auto_pull(
           Companies.current(),
           %{currency_rates_auto_pull: enabled},
           actor
         ) do
      {:ok, company} ->
        # Flipping ON should not silently leave the user waiting for
        # tomorrow's 08:00 UTC tick. Pull now so the rates list paints
        # straight away. Best-effort: a transient ECB outage shouldn't
        # block the toggle flip — `Refresh now` is right there for the
        # retry, and the daily cron is still scheduled.
        fresh =
          if enabled do
            case CurrencyRatesPull.run_now([]) do
              {:ok, _} -> Companies.current()
              {:error, _} -> company
            end
          else
            company
          end

        json(conn, %{company: Payloads.company(fresh)})

      {:error, %Ecto.Changeset{} = cs} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "validation_failed",
            "Couldn't toggle the auto-pull setting.",
            Errors.changeset_fields(cs)
          )
        )
    end
  end

  def update_currency_rates_auto_pull(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(
      Errors.payload(
        "bad_request",
        "Expected `enabled` (true | false)."
      )
    )
  end

  @doc """
  Manual ECB refresh trigger. Runs `CurrencyRatesPull.run_now/1`
  synchronously and reloads the company so the FE can revalidate the
  page. Same `company.edit` permission gates this as the auto-pull
  toggle — there's no separate "trigger refresh" capability since the
  feed is published reference data, not a decision.
  """
  def refresh_currency_rates_now(conn, _params) do
    company = Companies.current()

    if company.currency_rates_auto_pull do
      case CurrencyRatesPull.run_now([]) do
        {:ok, %{processed: processed}} ->
          fresh = Companies.current()

          json(conn, %{
            company: Payloads.company(fresh),
            processed: processed
          })

        {:error, reason} ->
          conn
          |> put_status(:bad_gateway)
          |> json(
            Errors.payload(
              "ecb_fetch_failed",
              "Couldn't reach the ECB feed. Try again in a moment — the daily 08:00 UTC tick will still run on schedule.",
              %{reason: inspect(reason)}
            )
          )
      end
    else
      conn
      |> put_status(:conflict)
      |> json(
        Errors.payload(
          "auto_pull_disabled",
          "Auto-pull is off — manage rates manually below."
        )
      )
    end
  end
end
