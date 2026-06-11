import { test, expect } from "@playwright/test";
import { apiCtx } from "./helpers/fixtures";

/**
 * Storage-cell purpose enum + decision-driven auto-routing.
 *
 * The compliance contract: a lot whose status flips to `available`
 * physically moves to a cell whose `purpose == "regular"`. Without
 * the auto-router, the lot's status column says "available" while
 * the lot itself still sits in a quarantine cell — a sticky-note
 * that lies. This spec proves the system moves the lot for real.
 *
 * Drives the API directly so it stays decisive and fast: the
 * plan-editor + lot-detail UI changes get their visual coverage
 * from `20-form-smoke` + the cells-dialog component tests.
 */

interface IdUuid {
  id: number;
  uuid: string;
}

async function createWarehouseWithPurposeCells(
  api: Awaited<ReturnType<typeof apiCtx>>,
): Promise<{
  warehouse: IdUuid;
  quarantineCellId: number;
  regularCellId: number;
}> {
  // Brand-new warehouse so the test is independent of dev DB state
  // and doesn't compete with other suites for cell ordinals.
  const tag = `cell-purposes-${Date.now()}`;
  const whRes = await api.post("/api/warehouses", {
    data: { name: `E2E ${tag}` },
  });
  expect(whRes.status(), "create warehouse").toBe(201);
  const warehouse = ((await whRes.json()) as { warehouse: IdUuid }).warehouse;

  const floorRes = await api.post(
    `/api/warehouses/${warehouse.uuid}/floors`,
    { data: { name: "Ground" } },
  );
  expect(floorRes.status(), "create floor").toBe(201);
  const floor = ((await floorRes.json()) as { floor: IdUuid }).floor;

  // One quarantine bay, one regular bay. Each gets a single cell so
  // the auto-router has exactly one candidate per purpose.
  async function makeBay(name: string, purpose: string): Promise<number> {
    const locRes = await api.post(
      `/api/warehouses/${warehouse.uuid}/storage-locations`,
      {
        data: {
          floor_uuid: floor.uuid,
          name,
          x: 0,
          y: 0,
          width: 100,
          height: 100,
        },
      },
    );
    expect(locRes.status(), `create ${name}`).toBe(201);
    const location = ((await locRes.json()) as {
      storage_location: IdUuid;
    }).storage_location;

    const cellRes = await api.post(
      `/api/warehouses/${warehouse.uuid}/storage-locations/${location.uuid}/cells`,
      {
        data: {
          name: `${name} L1`,
          purpose,
          width_m: "1",
          depth_m: "1",
          height_m: "1",
        },
      },
    );
    expect(cellRes.status(), `create ${purpose} cell`).toBe(201);
    const cell = ((await cellRes.json()) as { cell: IdUuid & { purpose: string } }).cell;
    expect(cell.purpose, `cell.${purpose}`).toBe(purpose);
    return cell.id;
  }

  const quarantineCellId = await makeBay("Quarantine Bay", "quarantine");
  const regularCellId = await makeBay("Regular Rack", "regular");

  return { warehouse, quarantineCellId, regularCellId };
}

test.describe("Storage cell purposes + auto-routing", () => {
  test("qc_passed moves lot from quarantine cell to regular cell", async ({
    playwright,
  }) => {
    const api = await apiCtx(playwright);
    const { warehouse, quarantineCellId, regularCellId } =
      await createWarehouseWithPurposeCells(api);

    // Need an item + UoM to receive a lot. Grab the first active item.
    const itemsRes = await api.get("/api/items?limit=10");
    const items = ((await itemsRes.json()) as {
      items: Array<{ id: number; stock_uom_id: number | null }>;
    }).items;
    const item = items.find((i) => i.stock_uom_id) ?? items[0];
    test.skip(!item, "no items seeded in dev DB");

    // Receive into the quarantine cell directly via the `placements`
    // payload shape. The lot will land at status=received with one
    // placement in the quarantine cell.
    const receiveRes = await api.post("/api/stock/lots/manual", {
      data: {
        item_id: item!.id,
        unit_of_measurement_id: item!.stock_uom_id,
        placements: [{ cell_id: quarantineCellId, qty: "10" }],
        package_length_mm: 100,
        package_width_mm: 100,
        package_height_mm: 100,
        package_weight_kg: "1",
        units_per_package: 1,
        stack_factor: 1,
      },
    });
    expect(receiveRes.status(), "receive lot").toBe(201);
    const lot = ((await receiveRes.json()) as {
      lot: {
        uuid: string;
        status: string;
        placements: Array<{ storage_cell_id: number; qty: string }>;
      };
    }).lot;
    expect(lot.status).toBe("received");
    const activeBeforeQc = lot.placements.filter((p) => Number(p.qty) > 0);
    expect(activeBeforeQc, "one active placement before QC").toHaveLength(1);
    expect(activeBeforeQc[0]!.storage_cell_id).toBe(quarantineCellId);

    // Post the qc_passed event. The auto-router must move the lot's
    // active placement out of the quarantine cell and into the
    // regular cell in the same transaction as the status flip.
    const eventRes = await api.post(
      `/api/stock/lots/${lot.uuid}/events`,
      { data: { kind: "qc_passed", reason: "Within spec — E2E" } },
    );
    expect(eventRes.status(), "qc_passed event").toBe(200);
    const after = ((await eventRes.json()) as {
      lot: {
        status: string;
        placements: Array<{ storage_cell_id: number; qty: string }>;
      };
    }).lot;
    expect(after.status, "lot status flipped").toBe("available");

    const activeAfter = after.placements.filter((p) => Number(p.qty) > 0);
    expect(activeAfter, "one active placement after auto-route").toHaveLength(
      1,
    );
    expect(
      activeAfter[0]!.storage_cell_id,
      "lot auto-routed to the regular cell",
    ).toBe(regularCellId);

    // Sanity: the original quarantine placement is still there but
    // zeroed out (movement-history rollup). The "active" filter
    // hides it from the operator-facing list.
    const allPlacements = after.placements;
    const quarantineRow = allPlacements.find(
      (p) => p.storage_cell_id === quarantineCellId,
    );
    expect(quarantineRow, "quarantine row exists").toBeTruthy();
    expect(Number(quarantineRow!.qty), "quarantine row is zeroed").toBe(0);

    await api.dispose();
    void warehouse;
  });
});
