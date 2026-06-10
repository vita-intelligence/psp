import { test, expect, type APIRequestContext } from "@playwright/test";
import fs from "node:fs";

/**
 * Volumetric + weight fit-check, exercised at the API. The recommendation
 * endpoint silently filters out cells where the lot wouldn't fit
 * (`fit.disqualified?`), so we probe it with two synthesised lots:
 *
 *   - A tiny lot (1mm × 1mm × 1mm, 0.001 kg, qty 1) — should be
 *     trivially "small" relative to every cell, so any tag-matched
 *     cell that exists should be returned with `fit.free_pct` near 100.
 *   - A huge lot (1m × 1m × 1m packaging, 100 kg, qty 1000) — should
 *     exceed every realistic cell. Either zero recommendations come
 *     back OR every returned rec must have `percent_used + free_pct ===
 *     100` (math is consistent).
 *
 * The test only asserts what we can guarantee against an unknown dev
 * DB: math consistency + that "huge" ≤ "tiny" in recommendation
 * count.
 */
test.use({ storageState: ".auth/laptop.json" });

const BACKEND = process.env.E2E_BACKEND_URL || "http://localhost:4000";

let api: APIRequestContext;
let bearer: string;

test.beforeAll(async ({ playwright }) => {
  const state = JSON.parse(fs.readFileSync(".auth/laptop.json", "utf-8")) as {
    cookies: Array<{ name: string; value: string }>;
  };
  bearer =
    state.cookies.find((c) => c.name === "psp_session")?.value ?? "";
  expect(bearer, "laptop.json must hold a psp_session cookie").not.toBe("");

  api = await playwright.request.newContext({
    baseURL: BACKEND,
    extraHTTPHeaders: { Authorization: `Bearer ${bearer}` },
  });
});

test.afterAll(async () => {
  await api?.dispose();
});

async function pickItemAndWarehouse(): Promise<{
  itemId: number;
  warehouseId: number;
  uomId: number | null;
}> {
  const itemsResp = await api.get("/api/items?limit=1");
  expect(itemsResp.ok()).toBeTruthy();
  const itemsJson = (await itemsResp.json()) as {
    items: Array<{ id: number; stock_uom?: { id: number } | null }>;
  };
  expect(itemsJson.items.length, "Need at least 1 item in the dev DB").toBeGreaterThan(0);
  const item = itemsJson.items[0];

  const whResp = await api.get("/api/warehouses?limit=1");
  expect(whResp.ok()).toBeTruthy();
  const whJson = (await whResp.json()) as {
    items: Array<{ id: number }>;
  };
  expect(whJson.items.length, "Need at least 1 warehouse").toBeGreaterThan(0);

  return {
    itemId: item.id,
    warehouseId: whJson.items[0].id,
    uomId: item.stock_uom?.id ?? null,
  };
}

async function createLot(input: {
  itemId: number;
  warehouseId: number;
  uomId: number | null;
  qty: string;
  packageLengthMm: number;
  packageWidthMm: number;
  packageHeightMm: number;
  packageWeightKg: string;
  unitsPerPackage: number;
  stackFactor: number;
}): Promise<{ uuid: string }> {
  const res = await api.post("/api/stock/lots/manual", {
    data: {
      item_id: input.itemId,
      warehouse_id: input.warehouseId,
      unit_of_measurement_id: input.uomId,
      qty_received: input.qty,
      status: "received",
      package_length_mm: input.packageLengthMm,
      package_width_mm: input.packageWidthMm,
      package_height_mm: input.packageHeightMm,
      package_weight_kg: input.packageWeightKg,
      units_per_package: input.unitsPerPackage,
      stack_factor: input.stackFactor,
    },
  });
  const body = (await res.json()) as { lot?: { uuid: string }; detail?: string };
  expect(
    res.ok(),
    `create lot failed: ${res.status()} ${JSON.stringify(body)}`,
  ).toBeTruthy();
  expect(body.lot?.uuid).toBeTruthy();
  return { uuid: body.lot!.uuid };
}

async function getRecs(lotUuid: string): Promise<
  Array<{
    cell: { uuid: string; id: number };
    fit?: { free_pct: number; percent_used: number };
  }>
> {
  const res = await api.get(
    `/api/stock/lots/${encodeURIComponent(lotUuid)}/move-recommendations`,
  );
  expect(res.ok(), `recs fetch failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as {
    items: Array<{
      cell: { uuid: string; id: number };
      fit?: { free_pct: number; percent_used: number };
    }>;
  };
  return body.items ?? [];
}

test.describe("Fit-check math", () => {
  test("oversized lot yields ≤ recommendations than the same lot at micro-size", async () => {
    const { itemId, warehouseId, uomId } = await pickItemAndWarehouse();
    test.skip(uomId === null, "First item has no stock_uom — skip fit-check probe.");

    // Tiny lot — should fit anywhere.
    const tiny = await createLot({
      itemId,
      warehouseId,
      uomId,
      qty: "1",
      packageLengthMm: 1,
      packageWidthMm: 1,
      packageHeightMm: 1,
      packageWeightKg: "0.001",
      unitsPerPackage: 1,
      stackFactor: 1,
    });
    const tinyRecs = await getRecs(tiny.uuid);

    // Huge lot — same item & warehouse, but oversized in every axis.
    const huge = await createLot({
      itemId,
      warehouseId,
      uomId,
      qty: "1000",
      packageLengthMm: 1_000,
      packageWidthMm: 1_000,
      packageHeightMm: 1_000,
      packageWeightKg: "100.000",
      unitsPerPackage: 1,
      stackFactor: 1,
    });
    const hugeRecs = await getRecs(huge.uuid);

    // Backend filters disqualified cells out, so huge ⊆ tiny in
    // recommendation set size (after the tag-match filter is the same
    // for both since item is identical).
    expect(
      hugeRecs.length,
      `huge lot should have at most as many recs as tiny lot (huge=${hugeRecs.length}, tiny=${tinyRecs.length})`,
    ).toBeLessThanOrEqual(tinyRecs.length);

    // Math sanity check on every returned rec — free_pct + percent_used
    // must sum to 100 within ±1 (rounding).
    for (const rec of [...tinyRecs, ...hugeRecs]) {
      if (!rec.fit) continue;
      const total = rec.fit.free_pct + rec.fit.percent_used;
      expect(
        Math.abs(total - 100),
        `fit math broken for cell ${rec.cell.uuid}: free_pct=${rec.fit.free_pct} percent_used=${rec.fit.percent_used}`,
      ).toBeLessThanOrEqual(1);
    }

    // The tiny lot — if any cells matched on tags — should leave most
    // of the space free. Strong signal that the math direction is
    // right (more goods on the lot → less free space).
    if (tinyRecs.length > 0) {
      const avgTinyFree =
        tinyRecs
          .filter((r) => r.fit)
          .reduce((acc, r) => acc + r.fit!.free_pct, 0) /
        Math.max(1, tinyRecs.filter((r) => r.fit).length);
      expect(
        avgTinyFree,
        "tiny lot should leave most of each cell free",
      ).toBeGreaterThan(50);
    }
  });
});
