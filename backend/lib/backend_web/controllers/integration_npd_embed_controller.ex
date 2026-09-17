defmodule BackendWeb.IntegrationNpdEmbedController do
  @moduledoc """
  Integration-scoped, bearer-authed proxies for the two NPD-rendered
  HTML documents PSP embeds on its Output-QC page:

    * `GET /manufacturing-orders/:uuid/npd-spec.html`
    * `GET /manufacturing-orders/:uuid/npd-validation.html`

  Both re-render NPD's canonical HTML for iframe embedding in an
  external caller (currently the vita-performance kiosk's Live-QC
  notes page), so floor QC sees the same spec sheet + validation
  the office QA reviewer sees at sign-off.

  Structurally these mirror the browser-authed variants on
  ``ManufacturingOrderController`` — private helpers duplicated on
  purpose to keep the browser flow untouched. If drift becomes a
  concern, extract into ``Backend.Production.NpdEmbeds`` and
  delegate from both places.
  """

  use BackendWeb, :controller

  import Ecto.Query
  import BackendWeb.IntegrationScopePlug

  alias Backend.Production

  plug :require_integration_scope, "mo:read"

  def mo_spec_html(conn, %{"uuid" => uuid}) do
    company_id = conn.assigns.current_company_id

    with company when not is_nil(company) <- Backend.Companies.current(),
         :ok <- ensure_npd_live(company),
         {:ok, item_uuid, _source} <-
           Production.resolve_reference_item_uuid_for_mo(company_id, uuid),
         {:ok, html} <- fetch_npd_spec_html(company, item_uuid) do
      conn
      |> put_resp_content_type("text/html")
      |> put_resp_header("cache-control", "no-store")
      |> put_resp_header("x-frame-options", "SAMEORIGIN")
      |> send_resp(200, html)
    else
      {:error, :mo_not_found} ->
        html_stub(conn, 404, "Manufacturing order not found.")

      {:error, :no_reference_item} ->
        html_stub(
          conn,
          404,
          "No spec on file — neither this MO's item nor any ancestor carries a finished-product spec."
        )

      {:error, :npd_not_configured} ->
        html_stub(conn, 503, "NPD integration isn't configured on PSP.")

      {:error, :npd_not_found} ->
        html_stub(conn, 404, "NPD has no spec sheet on file for this product yet.")

      {:error, {:npd_error, status}} ->
        html_stub(conn, 502, "NPD returned #{status} while rendering the sheet.")

      {:error, {:transport, reason}} ->
        html_stub(conn, 502, "Couldn't reach NPD: #{inspect(reason)}.")

      _ ->
        html_stub(conn, 500, "Couldn't resolve the company for this request.")
    end
  end

  def mo_validation_html(conn, %{"uuid" => uuid}) do
    company_id = conn.assigns.current_company_id

    with company when not is_nil(company) <- Backend.Companies.current(),
         :ok <- ensure_npd_live(company),
         {:ok, ref} <- validation_ref_for_mo(company_id, uuid),
         {:ok, html} <- fetch_npd_validation_html(company, ref) do
      conn
      |> put_resp_content_type("text/html")
      |> put_resp_header("cache-control", "no-store")
      |> put_resp_header("x-frame-options", "SAMEORIGIN")
      |> send_resp(200, html)
    else
      {:error, :mo_not_found} ->
        html_stub(conn, 404, "Manufacturing order not found.")

      {:error, :no_trial_batch} ->
        html_stub(
          conn,
          404,
          "This MO isn't linked to an NPD trial batch and its formulation has no canonical validation — no validation to show."
        )

      {:error, :npd_not_configured} ->
        html_stub(conn, 503, "NPD integration isn't configured on PSP.")

      {:error, :npd_not_found} ->
        html_stub(
          conn,
          404,
          "NPD hasn't recorded a passed validation for this formulation yet."
        )

      {:error, {:npd_error, status}} ->
        html_stub(conn, 502, "NPD returned #{status} while rendering the validation.")

      {:error, {:transport, reason}} ->
        html_stub(conn, 502, "Couldn't reach NPD: #{inspect(reason)}.")

      _ ->
        html_stub(conn, 500, "Couldn't resolve the company for this request.")
    end
  end

  # -------------------------------------------------------------------
  # Copies of the browser-side helpers on
  # ``BackendWeb.ManufacturingOrderController``. Kept private here so
  # the browser flow keeps its own copy and neither can accidentally
  # affect the other's request shape.
  # -------------------------------------------------------------------

  defp ensure_npd_live(company) do
    if Backend.Companies.npd_integration_live?(company),
      do: :ok,
      else: {:error, :npd_not_configured}
  end

  defp fetch_npd_spec_html(company, item_uuid) do
    base = String.trim_trailing(company.npd_base_url, "/")
    url = base <> "/api/psp-integration/specifications/latest.html"

    req =
      Req.new(
        url: url,
        params: [psp_item_uuid: item_uuid],
        headers: [{"authorization", "Bearer " <> company.npd_integration_token}],
        receive_timeout: 15_000
      )

    case Req.get(req) do
      {:ok, %Req.Response{status: 200, body: body}} when is_binary(body) ->
        {:ok, body}

      {:ok, %Req.Response{status: 404}} ->
        {:error, :npd_not_found}

      {:ok, %Req.Response{status: status}} ->
        {:error, {:npd_error, status}}

      {:error, reason} ->
        {:error, {:transport, reason}}
    end
  end

  defp validation_ref_for_mo(company_id, mo_uuid) do
    case Backend.Repo.one(
           from m in Backend.Production.ManufacturingOrder,
             where: m.company_id == ^company_id and m.uuid == ^mo_uuid
         ) do
      nil -> {:error, :mo_not_found}
      mo -> resolve_validation_ref(company_id, mo)
    end
  end

  defp resolve_validation_ref(company_id, mo) do
    case mo do
      %{npd_trial_batch_uuid: uuid} when is_binary(uuid) and byte_size(uuid) > 0 ->
        {:ok, {:trial_batch, uuid}}

      _ ->
        case trial_batch_from_ancestors(company_id, mo) do
          {:ok, uuid} -> {:ok, {:trial_batch, uuid}}
          {:error, :no_trial_batch} -> formulation_ref(mo)
        end
    end
  end

  defp formulation_ref(%{npd_formulation_uuid: uuid})
       when is_binary(uuid) and byte_size(uuid) > 0,
       do: {:ok, {:formulation, uuid}}

  defp formulation_ref(_), do: {:error, :no_trial_batch}

  defp trial_batch_from_ancestors(company_id, mo) do
    case mo.parent_mo_id do
      nil ->
        {:error, :no_trial_batch}

      parent_id ->
        parent = Backend.Repo.get(Backend.Production.ManufacturingOrder, parent_id)

        case parent do
          %{company_id: ^company_id, npd_trial_batch_uuid: uuid}
          when is_binary(uuid) and byte_size(uuid) > 0 ->
            {:ok, uuid}

          %{company_id: ^company_id} = parent_mo ->
            trial_batch_from_ancestors(company_id, parent_mo)

          _ ->
            {:error, :no_trial_batch}
        end
    end
  end

  defp fetch_npd_validation_html(company, ref) do
    base = String.trim_trailing(company.npd_base_url, "/")
    url = base <> "/api/psp-integration/validations/latest.html"

    params =
      case ref do
        {:trial_batch, uuid} -> [trial_batch: uuid]
        {:formulation, uuid} -> [formulation: uuid]
      end

    req =
      Req.new(
        url: url,
        params: params,
        headers: [{"authorization", "Bearer " <> company.npd_integration_token}],
        receive_timeout: 15_000
      )

    case Req.get(req) do
      {:ok, %Req.Response{status: 200, body: body}} when is_binary(body) ->
        {:ok, body}

      {:ok, %Req.Response{status: 404}} ->
        {:error, :npd_not_found}

      {:ok, %Req.Response{status: status}} ->
        {:error, {:npd_error, status}}

      {:error, reason} ->
        {:error, {:transport, reason}}
    end
  end

  defp html_stub(conn, status, message) do
    body = """
    <!doctype html>
    <html>
      <head><meta charset="utf-8" /><title>NPD embed</title></head>
      <body style="font-family: system-ui, sans-serif; padding: 2rem; color: #555;">
        <p>#{Plug.HTML.html_escape(message)}</p>
      </body>
    </html>
    """

    conn
    |> put_resp_content_type("text/html")
    |> put_resp_header("cache-control", "no-store")
    |> send_resp(status, body)
  end
end
