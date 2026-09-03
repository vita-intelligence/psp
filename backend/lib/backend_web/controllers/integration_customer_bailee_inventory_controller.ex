defmodule BackendWeb.IntegrationCustomerBaileeInventoryController do
  @moduledoc """
  `GET /api/integration/customer-bailee-inventory/:customer_uuid` —
  a customer's held bailee-custody stock, snapshot-ready for the
  vita-cff portal's warehouse-visibility page.

  Powers Phase 1 of the 3PL portal integration: customers see the
  finished-goods qty we're holding for them, the storage-cost meter,
  and dispatch-ready quantities. Read-only + scoped to the customer
  named on the path — a call for customer A can never leak lots
  held for customer B even if the integration token holder is on
  the wrong org (the token pipeline already enforces
  `current_company_id`; the customer lookup filters against that).

  Response shape:

      {
        "customer": {"uuid": "…", "name": "…"},
        "currency": "GBP",
        "rate_per_m3_per_day": "1.5000",
        "summary": {
          "lot_count": 3,
          "total_qty_on_hand": "1450.0000",
          "total_held_volume_m3": "0.5432",
          "total_accrued_charge": "12.34"
        },
        "lots": [
          {
            "uuid": "…", "code": "L00042",
            "item": {"uuid": "…", "name": "…", "code": "MA01446"},
            "qty_on_hand": "1450.0000",
            "unit_of_measurement": {"symbol": "pack"},
            "bailee_routed_at": "2026-08-15T09:00:00Z",
            "held_volume_m3": "0.5432",
            "accrued_charge": "12.34",
            "location": {
              "warehouse": "WH1",
              "floor": "Floor 2",
              "location": "Rack A",
              "cell": "Cell 3-1"
            }
          },
          ...
        ]
      }

  Empty lots array when the customer is unknown or has no held stock
  — customer-facing surfaces treat both cases the same as "nothing
  to show", not as an error. Rate + currency are echoed even when
  lots is empty so the portal can render the "we don't hold any of
  your stock right now, but our rate is X/m³/day" copy.
  """

  use BackendWeb, :controller

  alias Backend.{ThreePL, Companies}
  alias BackendWeb.Payloads

  action_fallback BackendWeb.FallbackController

  def show(conn, %{"customer_uuid" => customer_uuid}) do
    company_id = conn.assigns.current_company_id
    company = Companies.get!(company_id)

    lots = ThreePL.list_bailee_lots_for_customer(company_id, customer_uuid)
    rate = company.three_pl_rate_per_m3_per_day

    lot_rows = Enum.map(lots, &lot_payload(&1, rate))
    customer = first_customer(lots) || fallback_customer(company_id, customer_uuid)

    summary = %{
      lot_count: length(lot_rows),
      total_qty_on_hand: sum_field(lot_rows, "qty_on_hand"),
      total_held_volume_m3: sum_field(lot_rows, "held_volume_m3"),
      total_accrued_charge: sum_field(lot_rows, "accrued_charge")
    }

    json(conn, %{
      customer: customer,
      currency: company.currency_code || "GBP",
      rate_per_m3_per_day: decimal_to_string(rate),
      summary: summary,
      lots: lot_rows
    })
  end

  # ---- Payload shapers ----

  defp lot_payload(lot, rate) do
    volume = ThreePL.lot_held_volume_m3(lot)
    charge = ThreePL.accrued_charge(lot, rate)
    qty_on_hand = sum_placement_qty(lot.placements)

    %{
      "uuid" => lot.uuid,
      "code" => Payloads.render_entity_code(lot, "stock_lot"),
      "item" => %{
        "uuid" => lot.item && lot.item.uuid,
        "name" => lot.item && lot.item.name,
        "code" => Payloads.render_entity_code(lot.item, "item")
      },
      "qty_on_hand" => decimal_to_string(qty_on_hand),
      "unit_of_measurement" => %{
        "symbol" => (lot.unit_of_measurement && lot.unit_of_measurement.symbol) || ""
      },
      "bailee_routed_at" => iso_or_nil(lot.bailee_routed_at),
      "held_volume_m3" => decimal_to_string(volume),
      "accrued_charge" => decimal_to_string(charge),
      "location" => location_snapshot(lot.placements)
    }
  end

  defp location_snapshot([]), do: nil

  defp location_snapshot(placements) do
    # Placements with qty > 0 are the "still on the shelf" slice; a
    # zero-qty placement is a historical put-away row that survives
    # in the table but shouldn't drive the display. Pick the first
    # live one — bailee lots typically sit on a single 3PL cell.
    live =
      Enum.find(placements, fn p ->
        Decimal.compare(p.qty || Decimal.new(0), Decimal.new(0)) == :gt
      end)

    case live do
      %{storage_cell: cell} when not is_nil(cell) ->
        loc = cell.storage_location
        floor = loc && loc.floor
        warehouse = floor && floor.warehouse

        %{
          "warehouse" => warehouse && warehouse.name,
          "floor" => floor && floor.name,
          "location" => loc && (loc.name || loc.code),
          "cell" => cell.name
        }

      _ ->
        nil
    end
  end

  defp first_customer([%{bailee_customer: %{uuid: uuid, name: name}} | _]),
    do: %{"uuid" => uuid, "name" => name}

  defp first_customer(_), do: nil

  defp fallback_customer(company_id, customer_uuid) do
    # Same dual-identity trap as ``list_bailee_lots_for_customer/2`` —
    # NPD-side callers pass ``npd_source_uuid`` (their Django
    # ``Customer.id``) while staff-side hits carry the PSP-native
    # ``uuid``. Try the native lookup first then fall back to
    # npd_source_uuid so the portal's "no held stock" empty envelope
    # still echoes back the correct customer name.
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

  defp sum_placement_qty(placements) when is_list(placements) do
    Enum.reduce(placements, Decimal.new(0), fn p, acc ->
      Decimal.add(acc, p.qty || Decimal.new(0))
    end)
  end

  defp sum_placement_qty(_), do: Decimal.new(0)

  defp sum_field(rows, key) do
    rows
    |> Enum.reduce(Decimal.new(0), fn row, acc ->
      case Map.get(row, key) do
        s when is_binary(s) ->
          case Decimal.parse(s) do
            {d, _} -> Decimal.add(acc, d)
            _ -> acc
          end

        _ ->
          acc
      end
    end)
    |> Decimal.to_string(:normal)
  end

  defp decimal_to_string(nil), do: nil
  defp decimal_to_string(%Decimal{} = d), do: Decimal.to_string(d, :normal)
  defp decimal_to_string(other), do: to_string(other)

  defp iso_or_nil(nil), do: nil
  defp iso_or_nil(%DateTime{} = dt), do: DateTime.to_iso8601(dt)
  defp iso_or_nil(_), do: nil
end
