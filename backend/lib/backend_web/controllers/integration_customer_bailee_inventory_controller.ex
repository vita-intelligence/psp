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
          "total_qty_pending_dispatch": "150.0000",
          "total_qty_available": "1300.0000",
          "total_held_volume_m3": "0.5432",
          "total_accrued_charge": "12.34"
        },
        "lots": [
          {
            "uuid": "…", "code": "L00042",
            "item": {"uuid": "…", "name": "…", "code": "MA01446"},
            "qty_on_hand": "1450.0000",
            "qty_pending_dispatch": "150.0000",
            "qty_available": "1300.0000",
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

  def show(conn, %{"customer_uuid" => customer_uuid} = params) do
    company_id = conn.assigns.current_company_id
    company = Companies.get!(company_id)
    rate = company.three_pl_rate_per_m3_per_day

    # Paginated slice for the visible list.
    {lots, next_cursor} =
      ThreePL.list_bailee_lots_for_customer(
        company_id,
        customer_uuid,
        list_opts(params)
      )

    pending_by_lot =
      ThreePL.pending_dispatch_qty_by_lot_ids(company_id, Enum.map(lots, & &1.id))

    lot_rows = Enum.map(lots, &lot_payload(&1, rate, pending_by_lot))

    # Unpaginated summary — rolled up across ALL of the customer's
    # held stock so the "total held volume / accrued charge" tiles
    # stay accurate as they scroll through pages of individual lots.
    %{lot_count: total_lot_count, lots: all_lots} =
      ThreePL.bailee_lots_summary_for_customer(company_id, customer_uuid)

    all_pending_by_lot =
      ThreePL.pending_dispatch_qty_by_lot_ids(
        company_id,
        Enum.map(all_lots, & &1.id)
      )

    summary =
      Enum.reduce(
        all_lots,
        %{
          lot_count: total_lot_count,
          total_qty_on_hand: Decimal.new(0),
          total_qty_pending_dispatch: Decimal.new(0),
          total_qty_available: Decimal.new(0),
          total_held_volume_m3: Decimal.new(0),
          total_accrued_charge: Decimal.new(0)
        },
        fn lot, acc ->
          qty = sum_placement_qty(lot.placements)
          pending = Map.get(all_pending_by_lot, lot.id, Decimal.new(0))
          diff = Decimal.sub(qty, pending)
          available =
            if Decimal.compare(diff, Decimal.new(0)) == :lt,
              do: Decimal.new(0),
              else: diff

          vol = ThreePL.lot_held_volume_m3(lot)
          charge = ThreePL.accrued_charge(lot, rate)

          %{
            acc
            | total_qty_on_hand: Decimal.add(acc.total_qty_on_hand, qty),
              total_qty_pending_dispatch:
                Decimal.add(acc.total_qty_pending_dispatch, pending),
              total_qty_available:
                Decimal.add(acc.total_qty_available, available),
              total_held_volume_m3:
                Decimal.add(acc.total_held_volume_m3, vol || Decimal.new(0)),
              total_accrued_charge:
                Decimal.add(acc.total_accrued_charge, charge || Decimal.new(0))
          }
        end
      )
      |> stringify_summary()

    customer = first_customer(lots) || fallback_customer(company_id, customer_uuid)

    json(conn, %{
      customer: customer,
      currency: company.currency_code || "GBP",
      rate_per_m3_per_day: decimal_to_string(rate),
      summary: summary,
      lots: lot_rows,
      next_cursor: next_cursor
    })
  end

  defp list_opts(params) when is_map(params) do
    [q: params["q"], cursor: params["cursor"], limit: params["limit"]]
  end

  defp list_opts(_), do: []

  defp stringify_summary(sum) do
    %{
      lot_count: sum.lot_count,
      total_qty_on_hand: Decimal.to_string(sum.total_qty_on_hand, :normal),
      total_qty_pending_dispatch:
        Decimal.to_string(sum.total_qty_pending_dispatch, :normal),
      total_qty_available:
        Decimal.to_string(sum.total_qty_available, :normal),
      total_held_volume_m3:
        Decimal.to_string(sum.total_held_volume_m3, :normal),
      total_accrued_charge:
        Decimal.to_string(sum.total_accrued_charge, :normal)
    }
  end

  # ---- Payload shapers ----

  defp lot_payload(lot, rate, pending_by_lot) do
    volume = ThreePL.lot_held_volume_m3(lot)
    charge = ThreePL.accrued_charge(lot, rate)
    qty_on_hand = sum_placement_qty(lot.placements)
    pending = Map.get(pending_by_lot, lot.id, Decimal.new(0))
    # Guard: pending shouldn't exceed on-hand under normal flow (the
    # request endpoint enforces `ensure_bailee_qty_available` before
    # inserting) but if a race or manual manipulation gets us there,
    # clamp `available` to zero rather than expose a negative to the
    # customer-facing surface.
    diff = Decimal.sub(qty_on_hand, pending)
    available =
      if Decimal.compare(diff, Decimal.new(0)) == :lt, do: Decimal.new(0), else: diff

    %{
      "uuid" => lot.uuid,
      "code" => Payloads.render_entity_code(lot, "stock_lot"),
      "item" => %{
        "uuid" => lot.item && lot.item.uuid,
        "name" => lot.item && lot.item.name,
        "code" => Payloads.render_entity_code(lot.item, "item")
      },
      "qty_on_hand" => decimal_to_string(qty_on_hand),
      "qty_pending_dispatch" => decimal_to_string(pending),
      "qty_available" => decimal_to_string(available),
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
    # Only bailee-custody placements represent "held for you" stock.
    # Dispatch-cell placements are already committed to an outbound
    # shipment (the picker walked them to the shipping bay) and
    # shouldn't drive the location display — otherwise a partial
    # dispatch flips the customer's card from "on rack A" to "on
    # dispatch bay" mid-flow. Zero-qty placements are historical
    # put-away rows that survive in the table but shouldn't drive
    # the display either.
    live =
      Enum.find(placements, fn p ->
        bailee_placement?(p) and
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

  # Customer-facing "on hand" only counts what's still in bailee
  # custody. A completed dispatch walks goods from a three_pl_storage
  # cell to a dispatch cell — those units are already committed to
  # an outbound shipment and shouldn't be re-requestable, so they
  # drop out of this sum. Matches the filter
  # ``Backend.ThreePL.lot_held_volume_m3/1`` already applies to the
  # volume / accrued-charge computations.
  defp sum_placement_qty(placements) when is_list(placements) do
    Enum.reduce(placements, Decimal.new(0), fn p, acc ->
      if bailee_placement?(p) do
        Decimal.add(acc, p.qty || Decimal.new(0))
      else
        acc
      end
    end)
  end

  defp sum_placement_qty(_), do: Decimal.new(0)

  defp bailee_placement?(%{storage_cell: %{purpose: "three_pl_storage"}}), do: true
  defp bailee_placement?(_), do: false

  defp decimal_to_string(nil), do: nil
  defp decimal_to_string(%Decimal{} = d), do: Decimal.to_string(d, :normal)
  defp decimal_to_string(other), do: to_string(other)

  defp iso_or_nil(nil), do: nil
  defp iso_or_nil(%DateTime{} = dt), do: DateTime.to_iso8601(dt)
  defp iso_or_nil(_), do: nil
end
