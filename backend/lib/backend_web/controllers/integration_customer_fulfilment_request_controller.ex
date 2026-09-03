defmodule BackendWeb.IntegrationCustomerFulfilmentRequestController do
  @moduledoc """
  `POST /api/integration/customer-fulfilment-requests` — Phase 2 of
  the 3PL portal integration. Accepts a dispatch request that
  originated from a customer's portal (or, Phase 3, from their
  Shopify webhook / custom-storefront API).

  Body:

      {
        "customer_uuid": "…",
        "lot_uuid": "…",
        "qty": "150",
        "reference": "…" (optional — customer's own reference),
        "notes": "…" (optional),
        "source": "portal" | "shopify_webhook" | "custom_api" (default: "portal"),
        "external_reference": "…" (optional — Shopify order id or similar)
      }

  Same effect as a staff-typed request on the desktop — a `pending`
  row lands on the mobile picker queue; the physical dispatch fires
  when a picker completes it on mobile. The mobile side runs
  identical to today; the ONLY difference on the wire is `source`
  (visible on the picker queue so the operator knows the customer
  is waiting for a webhook back on Phase 3), plus the nullable
  `external_reference` (Phase 2 sends nil; Phase 3 fills it).

  Ownership enforcement lives inside
  :func:`Backend.ThreePL.request_customer_dispatch/1` — a leaked
  `lot_uuid` to a non-owner is rejected as `:not_owner` before any
  row is written.
  """

  use BackendWeb, :controller

  alias Backend.ThreePL

  action_fallback BackendWeb.FallbackController

  def create(conn, params) do
    company_id = conn.assigns.current_company_id

    attrs =
      %{
        "company_id" => company_id,
        "customer_uuid" => params["customer_uuid"],
        "lot_uuid" => params["lot_uuid"],
        "qty" => params["qty"],
        "reference" => params["reference"],
        "notes" => params["notes"],
        "source" => params["source"],
        "external_reference" => params["external_reference"]
      }

    case ThreePL.request_customer_dispatch(attrs) do
      {:ok, dispatch} ->
        conn
        |> put_status(:created)
        |> json(dispatch_payload(dispatch))

      {:error, :not_bailee} ->
        conn
        |> put_status(:not_found)
        |> json(%{detail: "lot_not_found", message: "Lot not found or not held in bailee custody."})

      {:error, :not_owner} ->
        conn
        |> put_status(:not_found)
        |> json(%{detail: "lot_not_found", message: "Lot not found for this customer."})

      {:error, :bad_qty} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{detail: "bad_qty", message: "Quantity must be a positive number."})

      {:error, :no_bailee_placement} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{detail: "no_bailee_placement", message: "Lot has no on-shelf quantity to dispatch."})

      {:error, :insufficient_qty} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{
          detail: "insufficient_qty",
          message: "Requested quantity exceeds what's currently on our shelves for this lot (net of pending requests)."
        })

      {:error, {:missing_key, key}} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{detail: "missing_key", message: "Missing required field: #{key}."})

      {:error, %Ecto.Changeset{} = cs} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{
          detail: "validation_error",
          errors: BackendWeb.ChangesetJSON.error(%{changeset: cs})
        })
    end
  end

  defp dispatch_payload(dispatch) do
    %{
      uuid: dispatch.uuid,
      status: dispatch.status,
      qty: Decimal.to_string(dispatch.qty || Decimal.new(0), :normal),
      reference: dispatch.reference,
      notes: dispatch.notes,
      source: dispatch.source,
      external_reference: dispatch.external_reference,
      requested_at:
        case dispatch.requested_at do
          %DateTime{} = dt -> DateTime.to_iso8601(dt)
          _ -> nil
        end,
      dispatched_at:
        case dispatch.dispatched_at do
          %DateTime{} = dt -> DateTime.to_iso8601(dt)
          _ -> nil
        end
    }
  end
end
