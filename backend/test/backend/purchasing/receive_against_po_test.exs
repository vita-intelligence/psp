defmodule Backend.Purchasing.ReceiveAgainstPoTest do
  @moduledoc """
  Heterogeneous PO receive — one line lands as N packs, each pack
  becomes its own stock_lot. Receipt failures cost the warehouse a
  day to unpick, so every rule (sum ≤ remaining, non-positive
  validation, transaction rollback) gets a direct assertion.
  """

  use Backend.DataCase, async: false

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Items.Item
  alias Backend.Purchasing
  alias Backend.Purchasing.{PurchaseOrder, PurchaseOrderLine, VendorItemPrice}
  alias Backend.Repo
  alias Backend.Stock.{Lifecycle, Lot, LotEvent}
  alias Backend.Units.UnitOfMeasurement
  alias Backend.Vendors.Vendor
  alias Backend.Warehouses.Warehouse

  # ----- fixtures --------------------------------------------------

  defp dec(v), do: Decimal.new(to_string(v))

  defp company_fixture do
    Repo.insert!(%Company{name: "Receive Co"})
  end

  defp user_fixture(company) do
    n = System.unique_integer([:positive])

    Repo.insert!(%User{
      company_id: company.id,
      email: "receiver-#{n}@example.com",
      name: "Receiver #{n}",
      hashed_password: "$2b$12$placeholder",
      is_active: true,
      confirmed_at: DateTime.utc_now() |> DateTime.truncate(:second)
    })
  end

  defp uom_fixture(company) do
    n = System.unique_integer([:positive])

    Repo.insert!(%UnitOfMeasurement{
      company_id: company.id,
      name: "Kilogram-#{n}",
      symbol: "kg#{n}",
      dimension: "mass",
      factor_to_base: Decimal.new("1"),
      is_base: true,
      is_active: true
    })
  end

  defp item_fixture(company, uom, name \\ "Vitamin D3") do
    Repo.insert!(%Item{
      company_id: company.id,
      name: name,
      item_type: "raw_material",
      stock_uom_id: uom.id,
      is_active: true
    })
  end

  defp vendor_fixture(company) do
    Repo.insert!(%Vendor{
      company_id: company.id,
      name: "Acme Ingredients",
      currency_code: "GBP",
      approval_status: "approved",
      is_active: true
    })
  end

  defp warehouse_fixture(company) do
    Repo.insert!(%Warehouse{
      company_id: company.id,
      name: "WH-#{System.unique_integer([:positive])}",
      is_active: true
    })
  end

  defp insert_po(company, vendor, status \\ "ordered") do
    Repo.insert!(%PurchaseOrder{
      company_id: company.id,
      vendor_id: vendor.id,
      currency_code: "GBP",
      status: status
    })
  end

  defp insert_line(po, item, qty_ordered, unit_price) do
    qty_d = dec(qty_ordered)
    price_d = dec(unit_price)

    Repo.insert!(%PurchaseOrderLine{
      purchase_order_id: po.id,
      company_id: po.company_id,
      item_id: item.id,
      qty_ordered: qty_d,
      qty_received: Decimal.new(0),
      unit_price: price_d,
      line_subtotal: Decimal.mult(qty_d, price_d)
    })
  end

  defp pack(qty, opts \\ %{}) do
    base = %{
      "qty" => to_string(qty),
      "package_length_mm" => 400,
      "package_width_mm" => 300,
      "package_height_mm" => 250,
      "package_weight_kg" => "25.000",
      "units_per_package" => 1,
      "stack_factor" => 1
    }

    Map.merge(base, opts)
  end

  defp setup_world(_ctx) do
    company = company_fixture()
    actor = user_fixture(company)
    uom = uom_fixture(company)
    item = item_fixture(company, uom)
    vendor = vendor_fixture(company)
    warehouse = warehouse_fixture(company)
    po = insert_po(company, vendor)

    {:ok,
     company: company,
     actor: actor,
     uom: uom,
     item: item,
     vendor: vendor,
     warehouse: warehouse,
     po: po}
  end

  defp lots_for_po(po) do
    source_ref = render_source_ref(po)

    Repo.all(
      from(l in Lot,
        where: l.company_id == ^po.company_id and l.source_ref == ^source_ref,
        order_by: [asc: l.id]
      )
    )
  end

  defp render_source_ref(po) do
    po = Repo.preload(po, :company)
    Backend.Numbering.render(po.id, po.company, "purchase_order") || "PO##{po.id}"
  end

  defp events_for_lot(lot_id) do
    Repo.all(
      from(e in LotEvent,
        where: e.stock_lot_id == ^lot_id,
        order_by: [asc: e.inserted_at, asc: e.id]
      )
    )
  end

  # ----- scenarios -------------------------------------------------

  describe "receive_against_po/3 — happy paths" do
    setup :setup_world

    test "single_homogeneous_pack: 100kg as 4×25kg drums → 1 lot", ctx do
      line = insert_line(ctx.po, ctx.item, "100", "5.00")

      payload = %{
        "warehouse_id" => ctx.warehouse.id,
        "supplier_batch_no_default" => "BA25-1001",
        "lines" => [
          %{
            "line_uuid" => line.uuid,
            "packs" => [pack("100", %{"units_per_package" => 4})]
          }
        ]
      }

      assert {:ok, updated_po} = Purchasing.receive_against_po(ctx.actor, ctx.po, payload)

      lots = lots_for_po(updated_po)
      assert length(lots) == 1
      [lot] = lots
      assert Decimal.equal?(lot.qty_received, dec("100"))
      assert lot.units_per_package == 4
      assert lot.supplier_batch_no == "BA25-1001"
      assert lot.source_kind == "purchase_order"
      assert lot.status == "received"

      [refreshed_line] = Repo.all(from(l in PurchaseOrderLine, where: l.id == ^line.id))
      assert Decimal.equal?(refreshed_line.qty_received, dec("100"))

      assert updated_po.status == "received"
    end

    test "two_distinct_packs_same_line: 50kg drums + 50kg bags → 2 lots", ctx do
      line = insert_line(ctx.po, ctx.item, "100", "5.00")

      payload = %{
        "warehouse_id" => ctx.warehouse.id,
        "supplier_batch_no_default" => "BA25-2001",
        "lines" => [
          %{
            "line_uuid" => line.uuid,
            "packs" => [
              pack("50",
                %{
                  "package_length_mm" => 400,
                  "package_width_mm" => 400,
                  "package_height_mm" => 600,
                  "units_per_package" => 2
                }),
              pack("50",
                %{
                  "package_length_mm" => 600,
                  "package_width_mm" => 400,
                  "package_height_mm" => 200,
                  "package_weight_kg" => "12.500",
                  "units_per_package" => 4
                })
            ]
          }
        ]
      }

      assert {:ok, updated_po} = Purchasing.receive_against_po(ctx.actor, ctx.po, payload)

      lots = lots_for_po(updated_po)
      assert length(lots) == 2
      [drum_lot, bag_lot] = lots
      assert drum_lot.package_height_mm == 600
      assert bag_lot.package_height_mm == 200
      assert drum_lot.units_per_package == 2
      assert bag_lot.units_per_package == 4

      total_received =
        lots
        |> Enum.map(& &1.qty_received)
        |> Enum.reduce(Decimal.new(0), &Decimal.add/2)

      assert Decimal.equal?(total_received, dec("100"))
      assert updated_po.status == "received"
    end

    test "partial_receipt: ordered 500, receive 300 → partially_received", ctx do
      line = insert_line(ctx.po, ctx.item, "500", "5.00")

      payload = %{
        "warehouse_id" => ctx.warehouse.id,
        "supplier_batch_no_default" => "BA25-3001",
        "lines" => [
          %{
            "line_uuid" => line.uuid,
            "packs" => [pack("300")]
          }
        ]
      }

      assert {:ok, updated_po} = Purchasing.receive_against_po(ctx.actor, ctx.po, payload)

      lots = lots_for_po(updated_po)
      assert length(lots) == 1
      [lot] = lots
      assert Decimal.equal?(lot.qty_received, dec("300"))

      refreshed_line = Repo.get!(PurchaseOrderLine, line.id)
      assert Decimal.equal?(refreshed_line.qty_received, dec("300"))
      remaining = Decimal.sub(refreshed_line.qty_ordered, refreshed_line.qty_received)
      assert Decimal.equal?(remaining, dec("200"))

      assert updated_po.status == "partially_received"
    end

    test "per_pack_batch_override: 2 packs with distinct batches", ctx do
      line = insert_line(ctx.po, ctx.item, "100", "5.00")

      payload = %{
        "warehouse_id" => ctx.warehouse.id,
        "supplier_batch_no_default" => "BA25-FALLBACK",
        "lines" => [
          %{
            "line_uuid" => line.uuid,
            "packs" => [
              pack("50", %{"supplier_batch_no" => "BA25-A"}),
              pack("50", %{"supplier_batch_no" => "BA25-B"})
            ]
          }
        ]
      }

      assert {:ok, updated_po} = Purchasing.receive_against_po(ctx.actor, ctx.po, payload)

      lots = lots_for_po(updated_po)
      assert length(lots) == 2
      batches = Enum.map(lots, & &1.supplier_batch_no) |> Enum.sort()
      assert batches == ["BA25-A", "BA25-B"]
      # The fallback should NOT leak onto either lot because both packs
      # overrode it explicitly.
      refute "BA25-FALLBACK" in batches
    end

    test "two_lines_different_packaging: each line lands with its own pack", ctx do
      line_a = insert_line(ctx.po, ctx.item, "100", "5.00")
      item_b = item_fixture(ctx.company, ctx.uom, "Vitamin B12")
      line_b = insert_line(ctx.po, item_b, "200", "8.00")

      payload = %{
        "warehouse_id" => ctx.warehouse.id,
        "supplier_batch_no_default" => "BA25-DEF",
        "lines" => [
          %{
            "line_uuid" => line_a.uuid,
            "packs" => [pack("100", %{"units_per_package" => 4})]
          },
          %{
            "line_uuid" => line_b.uuid,
            "packs" => [pack("200", %{"units_per_package" => 8})]
          }
        ]
      }

      assert {:ok, updated_po} = Purchasing.receive_against_po(ctx.actor, ctx.po, payload)

      lots = lots_for_po(updated_po) |> Enum.sort_by(& &1.item_id)
      assert length(lots) == 2

      refreshed_a = Repo.get!(PurchaseOrderLine, line_a.id)
      refreshed_b = Repo.get!(PurchaseOrderLine, line_b.id)
      assert Decimal.equal?(refreshed_a.qty_received, dec("100"))
      assert Decimal.equal?(refreshed_b.qty_received, dec("200"))

      assert updated_po.status == "received"
    end

    test "zero_packs_skips_line: empty packs list is a no-op", ctx do
      line = insert_line(ctx.po, ctx.item, "100", "5.00")

      payload = %{
        "warehouse_id" => ctx.warehouse.id,
        "lines" => [
          %{"line_uuid" => line.uuid, "packs" => []}
        ]
      }

      assert {:ok, updated_po} = Purchasing.receive_against_po(ctx.actor, ctx.po, payload)
      assert lots_for_po(updated_po) == []

      refreshed_line = Repo.get!(PurchaseOrderLine, line.id)
      assert Decimal.equal?(refreshed_line.qty_received, dec("0"))
      assert updated_po.status == "ordered"
    end

    test "per_pack_quarantine: route_to_quarantine emits the follow-up event", ctx do
      line = insert_line(ctx.po, ctx.item, "100", "5.00")

      payload = %{
        "warehouse_id" => ctx.warehouse.id,
        "supplier_batch_no_default" => "BA25-Q",
        "lines" => [
          %{
            "line_uuid" => line.uuid,
            "packs" => [pack("100", %{"route_to_quarantine" => true})]
          }
        ]
      }

      assert {:ok, updated_po} = Purchasing.receive_against_po(ctx.actor, ctx.po, payload)
      [lot] = lots_for_po(updated_po)

      events = events_for_lot(lot.id) |> Enum.map(& &1.kind)
      assert "received" in events
      assert "routed_to_quarantine" in events

      reloaded = Repo.get!(Lot, lot.id)
      assert reloaded.status == "quarantine"
      assert Lifecycle.project_status_for_lot(reloaded) == "quarantine"
    end

    test "re_receive_accumulation: 200 then 300 → 2 lots, line fully received", ctx do
      line = insert_line(ctx.po, ctx.item, "500", "5.00")

      payload_1 = %{
        "warehouse_id" => ctx.warehouse.id,
        "supplier_batch_no_default" => "BA25-FIRST",
        "lines" => [%{"line_uuid" => line.uuid, "packs" => [pack("200")]}]
      }

      assert {:ok, po_after_1} =
               Purchasing.receive_against_po(ctx.actor, ctx.po, payload_1)

      assert po_after_1.status == "partially_received"

      payload_2 = %{
        "warehouse_id" => ctx.warehouse.id,
        "supplier_batch_no_default" => "BA25-SECOND",
        "lines" => [%{"line_uuid" => line.uuid, "packs" => [pack("300")]}]
      }

      assert {:ok, po_after_2} =
               Purchasing.receive_against_po(ctx.actor, po_after_1, payload_2)

      lots = lots_for_po(po_after_2)
      assert length(lots) == 2

      refreshed_line = Repo.get!(PurchaseOrderLine, line.id)
      assert Decimal.equal?(refreshed_line.qty_received, dec("500"))
      assert po_after_2.status == "received"
    end
  end

  describe "receive_against_po/3 — rejection paths" do
    setup :setup_world

    test "over_receipt_rejected: 600 against 500-remaining line rolls back", ctx do
      line = insert_line(ctx.po, ctx.item, "500", "5.00")

      payload = %{
        "warehouse_id" => ctx.warehouse.id,
        "supplier_batch_no_default" => "BA25-OVER",
        "lines" => [%{"line_uuid" => line.uuid, "packs" => [pack("600")]}]
      }

      assert {:error, {:over_receipt, uuid}} =
               Purchasing.receive_against_po(ctx.actor, ctx.po, payload)

      assert uuid == line.uuid

      # Nothing landed.
      assert lots_for_po(ctx.po) == []

      refreshed_line = Repo.get!(PurchaseOrderLine, line.id)
      assert Decimal.equal?(refreshed_line.qty_received, dec("0"))
    end

    test "non_positive_dim_rejected: zero length_mm rolls back", ctx do
      line = insert_line(ctx.po, ctx.item, "100", "5.00")

      payload = %{
        "warehouse_id" => ctx.warehouse.id,
        "supplier_batch_no_default" => "BA25-BAD",
        "lines" => [
          %{
            "line_uuid" => line.uuid,
            "packs" => [pack("100", %{"package_length_mm" => 0})]
          }
        ]
      }

      assert {:error, {:non_positive_dim, 0}} =
               Purchasing.receive_against_po(ctx.actor, ctx.po, payload)

      assert lots_for_po(ctx.po) == []
    end

    test "non_positive_qty rejected", ctx do
      line = insert_line(ctx.po, ctx.item, "100", "5.00")

      payload = %{
        "warehouse_id" => ctx.warehouse.id,
        "supplier_batch_no_default" => "BA25-BADQ",
        "lines" => [
          %{
            "line_uuid" => line.uuid,
            "packs" => [pack("0")]
          }
        ]
      }

      assert {:error, {:non_positive_qty, 0}} =
               Purchasing.receive_against_po(ctx.actor, ctx.po, payload)
    end

    test "legacy_shape_rejected: old {line_uuid, qty} shape returns error code", ctx do
      line = insert_line(ctx.po, ctx.item, "100", "5.00")

      payload = %{
        "warehouse_id" => ctx.warehouse.id,
        "lines" => [%{"line_uuid" => line.uuid, "qty" => "100"}]
      }

      assert {:error, :legacy_shape_unsupported} =
               Purchasing.receive_against_po(ctx.actor, ctx.po, payload)
    end

    test "bad_line_uuid: unknown line uuid rejected", ctx do
      _line = insert_line(ctx.po, ctx.item, "100", "5.00")
      bogus = Ecto.UUID.generate()

      payload = %{
        "warehouse_id" => ctx.warehouse.id,
        "lines" => [%{"line_uuid" => bogus, "packs" => [pack("10")]}]
      }

      assert {:error, {:bad_line_uuid, ^bogus}} =
               Purchasing.receive_against_po(ctx.actor, ctx.po, payload)
    end

    test "warehouse_required when missing", ctx do
      line = insert_line(ctx.po, ctx.item, "100", "5.00")

      payload = %{
        "lines" => [%{"line_uuid" => line.uuid, "packs" => [pack("10")]}]
      }

      assert {:error, :warehouse_required} =
               Purchasing.receive_against_po(ctx.actor, ctx.po, payload)
    end
  end

  describe "receive_against_po/3 — side effects" do
    setup :setup_world

    test "vendor_prices_cache_updated: receipt refreshes the last-paid row", ctx do
      line = insert_line(ctx.po, ctx.item, "100", "5.0000")

      payload = %{
        "warehouse_id" => ctx.warehouse.id,
        "supplier_batch_no_default" => "BA25-CACHE",
        "lines" => [%{"line_uuid" => line.uuid, "packs" => [pack("100")]}]
      }

      assert {:ok, _po} = Purchasing.receive_against_po(ctx.actor, ctx.po, payload)

      row =
        Repo.one(
          from(p in VendorItemPrice,
            where:
              p.company_id == ^ctx.company.id and
                p.vendor_id == ^ctx.vendor.id and
                p.item_id == ^ctx.item.id and
                p.currency_code == "GBP"
          )
        )

      assert row
      assert Decimal.equal?(row.unit_price, dec("5.0000"))
    end

    test "lifecycle_received_event_per_lot: every lot has exactly one received event", ctx do
      line = insert_line(ctx.po, ctx.item, "100", "5.00")

      payload = %{
        "warehouse_id" => ctx.warehouse.id,
        "supplier_batch_no_default" => "BA25-LCE",
        "lines" => [
          %{
            "line_uuid" => line.uuid,
            "packs" => [pack("40"), pack("60")]
          }
        ]
      }

      assert {:ok, updated_po} = Purchasing.receive_against_po(ctx.actor, ctx.po, payload)

      lots = lots_for_po(updated_po)
      assert length(lots) == 2

      for lot <- lots do
        kinds = events_for_lot(lot.id) |> Enum.map(& &1.kind)
        assert Enum.count(kinds, &(&1 == "received")) == 1
      end
    end
  end
end
