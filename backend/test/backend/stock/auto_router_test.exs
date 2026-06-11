defmodule Backend.Stock.AutoRouterTest do
  @moduledoc """
  Storage-cell purpose enum + decision-driven auto-routing.

  These tests prove the compliance contract:

    * A lot whose status flips to `quarantine` ends up in a cell
      whose `purpose == "quarantine"`.
    * A lot whose status flips to `available` ends up in a `regular`
      cell.
    * Failed / held / rejected lots land in `rejected` / `hold` cells.
    * Disposed and depleted lots stay put — they're either physically
      destroyed or count zero on hand.
    * The router is idempotent: re-running it on a lot already in a
      matching cell is a no-op.
    * If the warehouse has no cell of the target purpose, the router
      logs a warning and leaves the placement alone — the lifecycle
      event must still succeed.
  """

  use Backend.DataCase, async: false

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Items.Item
  alias Backend.Repo
  alias Backend.Stock.{AutoRouter, Lifecycle, Lot, Movement, Placement}
  alias Backend.Units.UnitOfMeasurement
  alias Backend.Warehouses.{Floor, StorageCell, StorageLocation, Warehouse}

  # ----- fixtures --------------------------------------------------

  defp company_fixture do
    Repo.insert!(%Company{name: "AutoRouter Co"})
  end

  defp user_fixture(company) do
    Repo.insert!(%User{
      company_id: company.id,
      email: "auto-router-#{System.unique_integer([:positive])}@example.com",
      name: "Router Worker",
      hashed_password: "$pbkdf2-sha512$test$placeholder",
      is_active: true
    })
  end

  defp uom_fixture(company) do
    Repo.insert!(%UnitOfMeasurement{
      company_id: company.id,
      name: "Kilogram",
      symbol: "kg",
      dimension: "mass",
      factor_to_base: Decimal.new("1"),
      is_base: true,
      is_active: true
    })
  end

  defp item_fixture(company, uom) do
    Repo.insert!(%Item{
      company_id: company.id,
      name: "Sodium Citrate",
      item_type: "raw_material",
      stock_uom_id: uom.id
    })
  end

  defp warehouse_fixture(company) do
    Repo.insert!(%Warehouse{
      company_id: company.id,
      name: "WH-#{System.unique_integer([:positive])}",
      is_active: true
    })
  end

  defp floor_fixture(company, warehouse) do
    Repo.insert!(%Floor{
      company_id: company.id,
      warehouse_id: warehouse.id,
      name: "Ground",
      ordinal: 0
    })
  end

  defp location_fixture(company, warehouse, floor, opts \\ []) do
    Repo.insert!(%StorageLocation{
      company_id: company.id,
      warehouse_id: warehouse.id,
      floor_id: floor.id,
      name: Keyword.get(opts, :name, "Loc-#{System.unique_integer([:positive])}"),
      x: 0,
      y: 0,
      width: 100,
      height: 100
    })
  end

  defp cell_fixture(company, location, purpose, opts \\ []) do
    Repo.insert!(%StorageCell{
      company_id: company.id,
      storage_location_id: location.id,
      ordinal: Keyword.get(opts, :ordinal, 0),
      name: Keyword.get(opts, :name, "Cell-#{purpose}-#{System.unique_integer([:positive])}"),
      purpose: purpose
    })
  end

  # Lot at a known status with one placement at the given cell, qty 10.
  defp lot_in_cell(company, item, uom, cell, status) do
    lot =
      Repo.insert!(%Lot{
        company_id: company.id,
        item_id: item.id,
        unit_of_measurement_id: uom.id,
        status: status,
        qty_received: Decimal.new("10"),
        source_kind: "manual",
        package_length_mm: 100,
        package_width_mm: 100,
        package_height_mm: 100,
        package_weight_kg: Decimal.new("1"),
        units_per_package: 1,
        stack_factor: 1
      })

    Repo.insert!(%Placement{
      company_id: company.id,
      stock_lot_id: lot.id,
      storage_cell_id: cell.id,
      qty: Decimal.new("10")
    })

    lot
  end

  # A warehouse with one cell of every routing-relevant purpose plus
  # a regular cell. Each test pulls the cells it needs by purpose.
  defp setup_full_warehouse(_ctx) do
    company = company_fixture()
    user = user_fixture(company)
    uom = uom_fixture(company)
    item = item_fixture(company, uom)
    warehouse = warehouse_fixture(company)
    floor = floor_fixture(company, warehouse)

    locations = %{
      regular: location_fixture(company, warehouse, floor, name: "Regular Rack"),
      quarantine: location_fixture(company, warehouse, floor, name: "Quarantine Bay"),
      hold: location_fixture(company, warehouse, floor, name: "Hold Bay"),
      rejected: location_fixture(company, warehouse, floor, name: "Rejected Bay")
    }

    cells = %{
      regular: cell_fixture(company, locations.regular, "regular"),
      quarantine: cell_fixture(company, locations.quarantine, "quarantine"),
      hold: cell_fixture(company, locations.hold, "hold"),
      rejected: cell_fixture(company, locations.rejected, "rejected")
    }

    {:ok,
     company: company,
     user: user,
     uom: uom,
     item: item,
     warehouse: warehouse,
     floor: floor,
     locations: locations,
     cells: cells}
  end

  # ----- target_purpose_for/1 --------------------------------------

  describe "target_purpose_for/1" do
    test "maps every routed status" do
      assert AutoRouter.target_purpose_for("quarantine") == "quarantine"
      assert AutoRouter.target_purpose_for("on_hold") == "hold"
      assert AutoRouter.target_purpose_for("rejected") == "rejected"
      assert AutoRouter.target_purpose_for("available") == "regular"
    end

    test "no-op statuses return nil" do
      for status <- ~w(expected requested received depleted disposed canceled) do
        assert AutoRouter.target_purpose_for(status) == nil
      end
    end
  end

  # ----- routing via lifecycle events ------------------------------

  describe "auto-routing via lifecycle events" do
    setup :setup_full_warehouse

    test "lot at received routes to quarantine cell on routed_to_quarantine", ctx do
      # The lot lands at `received` in a regular cell; the QC
      # workflow then explicitly routes it to quarantine via the
      # `routed_to_quarantine` event. Auto-router must move it.
      lot = lot_in_cell(ctx.company, ctx.item, ctx.uom, ctx.cells.regular, "received")

      assert {:ok, %{status: "quarantine"}} =
               Lifecycle.record_event(lot, "routed_to_quarantine", actor_attrs(ctx.user))

      lot = Repo.reload!(lot) |> Repo.preload(:placements)
      active = Enum.filter(lot.placements, &Decimal.gt?(&1.qty, 0))
      assert length(active) == 1
      assert hd(active).storage_cell_id == ctx.cells.quarantine.id
    end

    test "lot passes qc_passed and routes to regular cell", ctx do
      lot = lot_in_cell(ctx.company, ctx.item, ctx.uom, ctx.cells.quarantine, "quarantine")

      assert {:ok, %{status: "available"}} =
               Lifecycle.record_event(lot, "qc_passed", actor_attrs(ctx.user))

      placements = active_placements(lot.id)
      assert length(placements) == 1
      assert hd(placements).storage_cell_id == ctx.cells.regular.id
    end

    test "lot fails qc and routes to rejected cell", ctx do
      lot = lot_in_cell(ctx.company, ctx.item, ctx.uom, ctx.cells.quarantine, "quarantine")

      assert {:ok, %{status: "rejected"}} =
               Lifecycle.record_event(lot, "qc_failed", actor_attrs(ctx.user, reason: "Salmonella"))

      placements = active_placements(lot.id)
      assert length(placements) == 1
      assert hd(placements).storage_cell_id == ctx.cells.rejected.id
    end

    test "lot held routes to hold cell", ctx do
      # Hold transitions only off `available` or `received`. Use the
      # received-then-hold path so we can prove the router on a real
      # state machine transition.
      lot = lot_in_cell(ctx.company, ctx.item, ctx.uom, ctx.cells.regular, "received")

      assert {:ok, %{status: "on_hold"}} =
               Lifecycle.record_event(lot, "held", actor_attrs(ctx.user, reason: "Vendor recall"))

      placements = active_placements(lot.id)
      assert length(placements) == 1
      assert hd(placements).storage_cell_id == ctx.cells.hold.id
    end

    test "disposed lot does not move", ctx do
      lot = lot_in_cell(ctx.company, ctx.item, ctx.uom, ctx.cells.rejected, "rejected")
      original_cell_id = ctx.cells.rejected.id

      assert {:ok, %{status: "disposed"}} =
               Lifecycle.record_event(lot, "disposed", actor_attrs(ctx.user, reason: "Incinerated"))

      import Ecto.Query
      placements = Repo.all(from p in Placement, where: p.stock_lot_id == ^lot.id)
      # The placement may still exist with its qty unchanged — disposed
      # lots are not physically moved by the router.
      assert length(placements) == 1
      assert hd(placements).storage_cell_id == original_cell_id
    end

    test "depleted lot does not move", ctx do
      # consumed_to_zero zeroes qty_on_hand by definition; the router
      # has no positive placement to move.
      lot = lot_in_cell(ctx.company, ctx.item, ctx.uom, ctx.cells.regular, "available")

      assert {:ok, %{status: "depleted"}} =
               Lifecycle.record_event(lot, "consumed_to_zero", actor_attrs(ctx.user))

      # Original placement is untouched (lifecycle doesn't zero
      # placements — a real consume flow would). Router skipped it.
      placements = active_placements(lot.id)
      assert length(placements) == 1
      assert hd(placements).storage_cell_id == ctx.cells.regular.id
      # And no auto_route movement got recorded.
      assert auto_route_movements(lot.id) == []
    end

    test "no matching cell logs warning but lifecycle still succeeds", ctx do
      # Brand-new warehouse with only a regular cell — no quarantine
      # cell exists. The router must leave the placement alone and
      # let the lifecycle event complete.
      bare_warehouse = warehouse_fixture(ctx.company)
      bare_floor = floor_fixture(ctx.company, bare_warehouse)
      bare_loc = location_fixture(ctx.company, bare_warehouse, bare_floor, name: "Bare")
      bare_cell = cell_fixture(ctx.company, bare_loc, "regular")

      lot = lot_in_cell(ctx.company, ctx.item, ctx.uom, bare_cell, "received")

      log =
        ExUnit.CaptureLog.capture_log(fn ->
          assert {:ok, %{status: "quarantine"}} =
                   Lifecycle.record_event(
                     lot,
                     "routed_to_quarantine",
                     actor_attrs(ctx.user)
                   )
        end)

      assert log =~ "no `quarantine` cell"

      # Placement untouched.
      placements = active_placements(lot.id)
      assert length(placements) == 1
      assert hd(placements).storage_cell_id == bare_cell.id
    end

    test "idempotent when already in matching cell", ctx do
      # Lot already in a quarantine cell, status `quarantine`.
      # Re-running an event that lands in quarantine should not move
      # the lot or write an extra auto_route movement.
      lot = lot_in_cell(ctx.company, ctx.item, ctx.uom, ctx.cells.quarantine, "received")

      assert {:ok, %{status: "quarantine"}} =
               Lifecycle.record_event(lot, "routed_to_quarantine", actor_attrs(ctx.user))

      # The lot was already in the quarantine cell — router did nothing.
      placements = active_placements(lot.id)
      assert length(placements) == 1
      assert hd(placements).storage_cell_id == ctx.cells.quarantine.id
      assert auto_route_movements(lot.id) == []
    end

    test "auto_route movement is recorded on the audit trail", ctx do
      lot = lot_in_cell(ctx.company, ctx.item, ctx.uom, ctx.cells.quarantine, "quarantine")

      assert {:ok, %{status: "available"}} =
               Lifecycle.record_event(lot, "qc_passed", actor_attrs(ctx.user))

      movements = auto_route_movements(lot.id)
      assert length(movements) == 1
      [m] = movements
      assert m.kind == "auto_route"
      assert m.reference_kind == "lifecycle_event"
      assert m.from_cell_id == ctx.cells.quarantine.id
      assert m.to_cell_id == ctx.cells.regular.id
    end
  end

  # ----- helpers ---------------------------------------------------

  defp actor_attrs(user, opts \\ []) do
    %{
      actor: user,
      actor_kind: "user",
      reason: Keyword.get(opts, :reason),
      metadata: Keyword.get(opts, :metadata, %{})
    }
  end

  defp active_placements(lot_id) do
    import Ecto.Query
    from(p in Placement, where: p.stock_lot_id == ^lot_id and p.qty > 0)
    |> Repo.all()
  end

  defp auto_route_movements(lot_id) do
    import Ecto.Query
    from(m in Movement,
      where: m.stock_lot_id == ^lot_id and m.kind == "auto_route"
    )
    |> Repo.all()
  end
end
