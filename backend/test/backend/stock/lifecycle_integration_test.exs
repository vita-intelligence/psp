defmodule Backend.Stock.LifecycleIntegrationTest do
  @moduledoc """
  End-to-end check that the lifecycle wires correctly into the real
  receive flows:

    1. Manual receive (`Backend.Stock.receive_lot/3`) emits a
       `received` event with `actor_kind: "user"` and flips the
       projected status to `received`.
    2. A subsequent `qc_passed` event flips the projection to
       `available`.

  We're not testing the full PO chain (that requires vendor +
  approval fixtures), but the same code path is exercised in
  `Backend.Stock.receive_lot/3`, so this proves the wiring.
  """

  use Backend.DataCase, async: false

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Items.Item
  alias Backend.Repo
  alias Backend.Stock
  alias Backend.Stock.{Lifecycle, LotEvent}
  alias Backend.Units.UnitOfMeasurement
  alias Backend.Warehouses.{Floor, StorageCell, StorageLocation, Warehouse}

  defp setup_world(_ctx) do
    company = Repo.insert!(%Company{name: "Integration Co"})

    user =
      Repo.insert!(%User{
        company_id: company.id,
        email: "integration-#{System.unique_integer([:positive])}@example.com",
        name: "Integration Worker",
        hashed_password: "$pbkdf2-sha512$test$placeholder",
        is_active: true
      })

    uom =
      Repo.insert!(%UnitOfMeasurement{
        company_id: company.id,
        name: "Kilogram",
        symbol: "kg",
        dimension: "mass",
        factor_to_base: Decimal.new("1"),
        is_base: true,
        is_active: true
      })

    item =
      Repo.insert!(%Item{
        company_id: company.id,
        name: "Sodium Citrate",
        item_type: "raw_material",
        stock_uom_id: uom.id
      })

    warehouse =
      Repo.insert!(%Warehouse{
        company_id: company.id,
        name: "WH1",
        is_active: true
      })

    floor =
      Repo.insert!(%Floor{
        company_id: company.id,
        warehouse_id: warehouse.id,
        name: "Ground",
        ordinal: 1
      })

    location =
      Repo.insert!(%StorageLocation{
        company_id: company.id,
        warehouse_id: warehouse.id,
        floor_id: floor.id,
        name: "Unregistered",
        code: "UR",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        system_kind: "unregistered"
      })

    cell =
      Repo.insert!(%StorageCell{
        company_id: company.id,
        storage_location_id: location.id,
        ordinal: 0,
        name: "U-0",
        system_kind: "unregistered"
      })

    {:ok,
     company: company,
     user: user,
     uom: uom,
     item: item,
     warehouse: warehouse,
     cell: cell}
  end

  describe "manual receive + QC pass" do
    setup :setup_world

    test "manual receive emits a `received` event and lot projects as received", ctx do
      attrs = %{
        "item_id" => ctx.item.id,
        "qty_received" => "10",
        "unit_of_measurement_id" => ctx.uom.id,
        "destination_cell_id" => ctx.cell.id,
        "package_length_mm" => 100,
        "package_width_mm" => 100,
        "package_height_mm" => 100,
        "package_weight_kg" => "1",
        "units_per_package" => 1,
        "stack_factor" => 1
      }

      assert {:ok, lot} = Stock.receive_lot(ctx.user, ctx.company.id, attrs)
      assert lot.status == "received"
      assert lot.source_kind == "manual"

      # One event row exists for this lot — the `received` event.
      events = Repo.all(from(e in LotEvent, where: e.stock_lot_id == ^lot.id))
      assert length(events) == 1
      [event] = events
      assert event.kind == "received"
      assert event.actor_id == ctx.user.id
      assert event.actor_kind == "user"

      # Projection from the event log matches the column.
      assert Lifecycle.project_status_for_lot(lot) == "received"
    end

    test "qc_pass after manual receive flips the projection to available", ctx do
      attrs = %{
        "item_id" => ctx.item.id,
        "qty_received" => "10",
        "unit_of_measurement_id" => ctx.uom.id,
        "destination_cell_id" => ctx.cell.id,
        "package_length_mm" => 100,
        "package_width_mm" => 100,
        "package_height_mm" => 100,
        "package_weight_kg" => "1",
        "units_per_package" => 1,
        "stack_factor" => 1
      }

      {:ok, lot} = Stock.receive_lot(ctx.user, ctx.company.id, attrs)

      assert {:ok, %{status: "available"}} =
               Lifecycle.record_event(lot, "qc_passed", %{
                 actor: ctx.user,
                 actor_kind: "user",
                 reason: "Within spec, COA verified"
               })

      reloaded = Repo.reload!(lot)
      assert reloaded.status == "available"
    end

    test "source_kind on operator-supplied attrs is ignored (compliance rule)", ctx do
      # Smuggle a forged source_kind in the attrs — the service must
      # strip it and write "manual" instead.
      attrs = %{
        "item_id" => ctx.item.id,
        "qty_received" => "10",
        "unit_of_measurement_id" => ctx.uom.id,
        "destination_cell_id" => ctx.cell.id,
        "source_kind" => "purchase_order",
        "package_length_mm" => 100,
        "package_width_mm" => 100,
        "package_height_mm" => 100,
        "package_weight_kg" => "1",
        "units_per_package" => 1,
        "stack_factor" => 1
      }

      assert {:ok, lot} = Stock.receive_lot(ctx.user, ctx.company.id, attrs)
      assert lot.source_kind == "manual"
    end

    test "service-layer source_kind hand-off is honoured for PO receive", ctx do
      # The procurement boundary uses the `__service_source_kind__`
      # key to declare "this receive is against a PO". Since the
      # PO-line FK on stock_lots is enforced (migration
      # 20260707100000), we need a real vendor + PO + line so the
      # receive doesn't trip the constraint.
      vendor =
        Repo.insert!(%Backend.Vendors.Vendor{
          company_id: ctx.company.id,
          name: "Test Vendor",
          currency_code: "GBP",
          approval_status: "approved",
          is_active: true
        })

      po =
        Repo.insert!(%Backend.Purchasing.PurchaseOrder{
          company_id: ctx.company.id,
          vendor_id: vendor.id,
          currency_code: "GBP",
          status: "ordered",
          default_warehouse_id: ctx.warehouse.id
        })

      po_line =
        Repo.insert!(%Backend.Purchasing.PurchaseOrderLine{
          company_id: ctx.company.id,
          purchase_order_id: po.id,
          item_id: ctx.item.id,
          warehouse_id: ctx.warehouse.id,
          qty_ordered: Decimal.new("10"),
          qty_received: Decimal.new("0"),
          unit_price: Decimal.new("1.00"),
          line_subtotal: Decimal.new("10.00")
        })

      attrs = %{
        "item_id" => ctx.item.id,
        "qty_received" => "10",
        "unit_of_measurement_id" => ctx.uom.id,
        "destination_cell_id" => ctx.cell.id,
        "__service_source_kind__" => "purchase_order",
        "__po_line_id__" => po_line.id,
        "source_ref" => "PO00007",
        "package_length_mm" => 100,
        "package_width_mm" => 100,
        "package_height_mm" => 100,
        "package_weight_kg" => "1",
        "units_per_package" => 1,
        "stack_factor" => 1
      }

      assert {:ok, lot} = Stock.receive_lot(ctx.user, ctx.company.id, attrs)
      assert lot.source_kind == "purchase_order"
      # PR 1: physical per-pack lots now carry the FK back to the PO
      # line so the cascade helpers can find them via a single-column
      # scan instead of joining through lot_events JSON.
      assert lot.purchase_order_line_id == po_line.id

      [event] = Repo.all(from(e in LotEvent, where: e.stock_lot_id == ^lot.id))
      assert event.metadata["po_line_id"] == po_line.id
      assert event.metadata["source_ref"] == "PO00007"
    end
  end
end
