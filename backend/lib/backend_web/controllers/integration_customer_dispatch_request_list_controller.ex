defmodule BackendWeb.IntegrationCustomerDispatchRequestListController do
  @moduledoc """
  `GET /api/integration/customer-dispatch-requests/:customer_uuid` —
  every dispatch request (any status) the customer has queued, newest
  first. Sister endpoint to ``customer-bailee-inventory``; powers the
  portal's `/portal/warehouse/requests` history page.

  Query params:
    * `status` — filter to `pending` / `completed` / `cancelled`.
      Omit to return every row.
    * `lot_uuid` — narrow to a single lot (portal "view requests for
      this lot" affordance).
    * `limit` — cap the row count (default 100, max 500).

  Response shape:

      {
        "customer": {"uuid": "…", "name": "…"},
        "summary": {
          "total": 12, "pending": 3, "completed": 8, "cancelled": 1
        },
        "requests": [
          {
            "uuid": "…", "status": "pending", "qty": "50.0000",
            "reference": "PO-9942", "notes": "…", "source": "portal",
            "requested_at": "…", "dispatched_at": null,
            "lot": {
              "uuid": "…", "code": "L00042",
              "item": {"name": "…", "code": "MA01446"},
              "unit_of_measurement": {"symbol": "pack"}
            }
          },
          ...
        ]
      }

  Ownership scope: PSP resolves the customer via the same dual-uuid
  lookup as :func:`Backend.ThreePL.list_bailee_lots_for_customer/2`
  (native `uuid` OR `npd_source_uuid`), then only returns rows whose
  lot's `bailee_customer_id` matches. No cross-customer leak paths.
  """

  use BackendWeb, :controller

  alias Backend.ThreePL
  alias Backend.ThreePL.Dispatch
  alias BackendWeb.Payloads

  action_fallback BackendWeb.FallbackController

  def index(conn, %{"customer_uuid" => customer_uuid} = params) do
    company_id = conn.assigns.current_company_id

    opts =
      []
      |> maybe_put(:status, sanitise_status(params["status"]))
      |> maybe_put(:lot_uuid, sanitise_uuid(params["lot_uuid"]))
      |> maybe_put(:limit, sanitise_limit(params["limit"]))

    rows =
      ThreePL.list_dispatch_requests_for_customer(company_id, customer_uuid, opts)

    request_rows = Enum.map(rows, &request_payload/1)
    customer = first_customer(rows) || fallback_customer(company_id, customer_uuid)

    json(conn, %{
      customer: customer,
      summary: summarise(rows),
      requests: request_rows
    })
  end

  # ---- Payload shapers ----

  defp request_payload(%Dispatch{} = d) do
    lot = d.stock_lot

    %{
      "uuid" => d.uuid,
      "status" => d.status,
      "qty" => decimal_to_string(d.qty),
      "reference" => d.reference,
      "notes" => d.notes,
      "source" => d.source,
      "external_reference" => d.external_reference,
      "requested_at" => iso_or_nil(d.requested_at),
      "dispatched_at" => iso_or_nil(d.dispatched_at),
      "lot" => lot_summary(lot)
    }
  end

  defp lot_summary(nil), do: nil

  defp lot_summary(lot) do
    %{
      "uuid" => lot.uuid,
      "code" => Payloads.render_entity_code(lot, "stock_lot"),
      "item" => %{
        "name" => lot.item && lot.item.name,
        "code" => Payloads.render_entity_code(lot.item, "item")
      },
      "unit_of_measurement" => %{
        "symbol" =>
          (lot.unit_of_measurement && lot.unit_of_measurement.symbol) || ""
      }
    }
  end

  defp summarise(rows) do
    Enum.reduce(rows, %{total: 0, pending: 0, completed: 0, cancelled: 0}, fn d, acc ->
      acc
      |> Map.update!(:total, &(&1 + 1))
      |> Map.update(String.to_atom(d.status), 1, &(&1 + 1))
    end)
  end

  # Reuses the ``bailee_customer`` from the joined lot preload — same
  # optimisation as the sister inventory endpoint.
  defp first_customer([%{stock_lot: %{bailee_customer: _}} = _row | _]), do: nil
  defp first_customer(_), do: nil

  defp fallback_customer(company_id, customer_uuid) do
    resolved =
      Backend.Repo.get_by(Backend.Customers.Customer,
        company_id: company_id,
        uuid: customer_uuid
      ) ||
        Backend.Repo.get_by(Backend.Customers.Customer,
          company_id: company_id,
          npd_source_uuid: customer_uuid
        )

    case resolved do
      nil -> %{"uuid" => customer_uuid, "name" => nil}
      c -> %{"uuid" => c.uuid, "name" => c.name}
    end
  rescue
    Ecto.Query.CastError -> %{"uuid" => customer_uuid, "name" => nil}
  end

  defp sanitise_status(s) when is_binary(s) do
    if s in Dispatch.statuses(), do: s, else: nil
  end

  defp sanitise_status(_), do: nil

  defp sanitise_uuid(s) when is_binary(s) do
    trimmed = String.trim(s)
    if trimmed == "", do: nil, else: trimmed
  end

  defp sanitise_uuid(_), do: nil

  defp sanitise_limit(s) when is_binary(s) do
    case Integer.parse(s) do
      {n, _} when n > 0 -> min(n, 500)
      _ -> nil
    end
  end

  defp sanitise_limit(_), do: nil

  defp maybe_put(kw, _key, nil), do: kw
  defp maybe_put(kw, key, val), do: Keyword.put(kw, key, val)

  defp decimal_to_string(nil), do: nil
  defp decimal_to_string(%Decimal{} = d), do: Decimal.to_string(d, :normal)
  defp decimal_to_string(other), do: to_string(other)

  defp iso_or_nil(nil), do: nil
  defp iso_or_nil(%DateTime{} = dt), do: DateTime.to_iso8601(dt)
  defp iso_or_nil(_), do: nil
end
