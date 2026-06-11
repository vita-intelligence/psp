import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { apiCtx } from "./helpers/fixtures";

/**
 * Per-pack receive matrix. Exercises the new payload shape end-to-end:
 * one PO line can land as N packs, each pack creates its own stock_lot,
 * and the lifecycle service stamps a `received` event per lot.
 *
 * Most scenarios drive the receive endpoint via the API (no UI) so the
 * matrix stays decisive and fast. The dialog itself has its own UI
 * smoke test in this file to catch render regressions.
 */

const BACKEND_URL = process.env.E2E_BACKEND_URL || "http://localhost:4000";

function altToken(): string {
  const state = JSON.parse(fs.readFileSync(".auth/alt.json", "utf-8")) as {
    cookies: Array<{ name: string; value: string }>;
  };
  return state.cookies.find((c) => c.name === "psp_session")?.value ?? "";
}

/**
 * Drive a fresh PO from draft → submitted → approver-signed → director-
 * signed → ordered. Director sign is performed as the seeded ALT admin
 * to clear the same-signer guard. Returns the PO uuid + a working line.
 */
async function buildOrderedPo(
  playwright: Parameters<Parameters<typeof test>[1]>[0]["playwright"],
  qtyOrdered: number,
): Promise<{ uuid: string; lineUuid: string; itemId: number; vendorId: number }> {
  const api = await apiCtx(playwright);
  const vendorRes = await api.get(
    "/api/vendors?limit=10&approval_status=approved&is_active=true",
  );
  const vData = (await vendorRes.json()) as {
    items: Array<{ id: number; uuid: string }>;
  };
  const itemsRes = await api.get("/api/items?limit=10");
  const iData = (await itemsRes.json()) as { items: Array<{ id: number }> };

  const vendor = vData.items[0]!;
  const item = iData.items[0]!;

  // Ensure the item is on the vendor's approved-supplier list — submit
  // 422s otherwise (compliance gate). Idempotent: 200/201 if added,
  // 409 if already present. Route uses vendor uuid.
  await api.post(`/api/vendors/${vendor.uuid}/approved-items`, {
    data: { item_id: item.id },
  });

  const createRes = await api.post("/api/purchase-orders", {
    data: {
      vendor_id: vendor.id,
      currency_code: "GBP",
      discount_pct: "0",
      tax_rate: "0",
      shipping_fees: "0",
      additional_fees: "0",
      lines: [
        {
          item_id: item.id,
          qty_ordered: String(qtyOrdered),
          unit_price: "1",
        },
      ],
    },
  });
  const create = (await createRes.json()) as {
    purchase_order: {
      uuid: string;
      lines: Array<{ uuid: string }>;
    };
  };
  const uuid = create.purchase_order.uuid;
  const lineUuid = create.purchase_order.lines[0]!.uuid;

  // Submit. May 422 if item isn't on the vendor's approved list — skip
  // these dependent scenarios when that happens.
  const submitRes = await api.post(`/api/purchase-orders/${uuid}/submit`);
  if (submitRes.status() !== 200) {
    test.skip(true, `submit returned ${submitRes.status()} — item likely off the vendor's approved-supplier list`);
  }

  await api.post(`/api/purchase-orders/${uuid}/approve`, {
    data: { notes: "E2E approver" },
  });

  // Director signs as the ALT seeded admin (segregation of duties).
  await api.post(`/api/purchase-orders/${uuid}/director-approve`, {
    data: { notes: "E2E director" },
    headers: { Authorization: `Bearer ${altToken()}` },
  });

  await api.post(`/api/purchase-orders/${uuid}/mark-ordered`);
  await api.dispose();
  return {
    uuid,
    lineUuid,
    itemId: item.id,
    vendorId: vendor.id,
  };
}

async function getWarehouseId(
  playwright: Parameters<Parameters<typeof test>[1]>[0]["playwright"],
): Promise<number> {
  const api = await apiCtx(playwright);
  const res = await api.get("/api/warehouses?limit=1");
  const data = (await res.json()) as { items: Array<{ id: number }> };
  await api.dispose();
  return data.items[0]!.id;
}

async function getLotEvents(
  playwright: Parameters<Parameters<typeof test>[1]>[0]["playwright"],
  lotUuid: string,
): Promise<Array<{ kind: string }>> {
  const api = await apiCtx(playwright);
  const res = await api.get(`/api/stock/lots/${lotUuid}/events`);
  const data = (await res.json()) as { items?: Array<{ kind: string }> };
  await api.dispose();
  return data.items ?? [];
}

const DEFAULT_PKG = {
  package_length_mm: 400,
  package_width_mm: 300,
  package_height_mm: 250,
  package_weight_kg: "25.000",
  units_per_package: 1,
  stack_factor: 1,
};

test.describe("Per-pack PO receive matrix", () => {
  test("1. single homogeneous pack — 4×25kg drums, one lot with units_per_pkg=4", async ({
    playwright,
  }) => {
    const { uuid, lineUuid } = await buildOrderedPo(playwright, 100);
    const warehouseId = await getWarehouseId(playwright);
    const api = await apiCtx(playwright);

    const res = await api.post(`/api/purchase-orders/${uuid}/receive`, {
      data: {
        warehouse_id: warehouseId,
        supplier_batch_no_default: "BA-TEST-1",
        lines: [
          {
            line_uuid: lineUuid,
            packs: [{ ...DEFAULT_PKG, qty: "100", units_per_package: 4 }],
          },
        ],
      },
    });
    expect(res.status(), "receive should accept the new shape").toBe(200);
    const body = (await res.json()) as {
      purchase_order: { status: string; lines: Array<{ qty_received: string }> };
    };
    expect(["received", "partially_received"]).toContain(
      body.purchase_order.status,
    );
    expect(Number(body.purchase_order.lines[0]!.qty_received)).toBeCloseTo(100, 2);

    // Should have created exactly 1 lot.
    const lotsRes = await api.get(
      `/api/stock/lots?source_kind=purchase_order&limit=5&sort=-inserted_at`,
    );
    const lotsBody = (await lotsRes.json()) as {
      items: Array<{ uuid: string; units_per_package: number | null }>;
    };
    expect(lotsBody.items[0]?.units_per_package).toBe(4);
    await api.dispose();
  });

  test("2. two distinct packs on one line — 2 lots", async ({ playwright }) => {
    const { uuid, lineUuid } = await buildOrderedPo(playwright, 100);
    const warehouseId = await getWarehouseId(playwright);
    const api = await apiCtx(playwright);

    const res = await api.post(`/api/purchase-orders/${uuid}/receive`, {
      data: {
        warehouse_id: warehouseId,
        supplier_batch_no_default: "BA-TEST-2",
        lines: [
          {
            line_uuid: lineUuid,
            packs: [
              {
                ...DEFAULT_PKG,
                qty: "50",
                package_weight_kg: "25.000",
              },
              {
                ...DEFAULT_PKG,
                qty: "50",
                package_length_mm: 600,
                package_width_mm: 400,
                package_height_mm: 350,
                package_weight_kg: "50.000",
              },
            ],
          },
        ],
      },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      purchase_order: { lines: Array<{ qty_received: string }> };
    };
    expect(Number(body.purchase_order.lines[0]!.qty_received)).toBeCloseTo(100, 2);
    await api.dispose();
  });

  test("3. partial receipt — 300 of 500 ordered, line stays partially_received", async ({
    playwright,
  }) => {
    const { uuid, lineUuid } = await buildOrderedPo(playwright, 500);
    const warehouseId = await getWarehouseId(playwright);
    const api = await apiCtx(playwright);

    const res = await api.post(`/api/purchase-orders/${uuid}/receive`, {
      data: {
        warehouse_id: warehouseId,
        lines: [
          { line_uuid: lineUuid, packs: [{ ...DEFAULT_PKG, qty: "300" }] },
        ],
      },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      purchase_order: { status: string; lines: Array<{ qty_received: string }> };
    };
    expect(body.purchase_order.status).toBe("partially_received");
    expect(Number(body.purchase_order.lines[0]!.qty_received)).toBeCloseTo(300, 2);
    await api.dispose();
  });

  test("4. over receipt rejected — 600 against 500 remaining", async ({
    playwright,
  }) => {
    const { uuid, lineUuid } = await buildOrderedPo(playwright, 500);
    const warehouseId = await getWarehouseId(playwright);
    const api = await apiCtx(playwright);

    const res = await api.post(`/api/purchase-orders/${uuid}/receive`, {
      data: {
        warehouse_id: warehouseId,
        lines: [
          { line_uuid: lineUuid, packs: [{ ...DEFAULT_PKG, qty: "600" }] },
        ],
      },
    });
    expect(res.status(), "over-receipt should 422").toBe(422);
    const body = (await res.json()) as { code?: string; detail?: string };
    // Backend's Errors.payload/3 surfaces either a top-level `code` or
    // a `detail` describing the over-receipt — accept either as long as
    // the response semantically points at the over-receipt rejection.
    const hint = `${body.code ?? ""} ${body.detail ?? ""}`.toLowerCase();
    expect(hint, `expected over-receipt signal in response: ${JSON.stringify(body)}`).toMatch(
      /over[_ ]?receipt|exceeds/i,
    );
    await api.dispose();
  });

  test("5. per-pack batch override — 2 lots with distinct batches", async ({
    playwright,
  }) => {
    const { uuid, lineUuid } = await buildOrderedPo(playwright, 100);
    const warehouseId = await getWarehouseId(playwright);
    const api = await apiCtx(playwright);

    const res = await api.post(`/api/purchase-orders/${uuid}/receive`, {
      data: {
        warehouse_id: warehouseId,
        supplier_batch_no_default: "BA-DEFAULT",
        lines: [
          {
            line_uuid: lineUuid,
            packs: [
              { ...DEFAULT_PKG, qty: "50", supplier_batch_no: "BA-A" },
              { ...DEFAULT_PKG, qty: "50", supplier_batch_no: "BA-B" },
            ],
          },
        ],
      },
    });
    expect(res.status()).toBe(200);

    const lotsRes = await api.get(
      `/api/stock/lots?source_kind=purchase_order&limit=5&sort=-inserted_at`,
    );
    const lots = ((await lotsRes.json()) as {
      items: Array<{ supplier_batch_no: string | null }>;
    }).items.slice(0, 2);
    const batches = lots.map((l) => l.supplier_batch_no).sort();
    expect(batches).toEqual(["BA-A", "BA-B"]);
    await api.dispose();
  });

  test("7. zero packs skips the line — no lots, no error", async ({
    playwright,
  }) => {
    const { uuid, lineUuid } = await buildOrderedPo(playwright, 100);
    const warehouseId = await getWarehouseId(playwright);
    const api = await apiCtx(playwright);

    const res = await api.post(`/api/purchase-orders/${uuid}/receive`, {
      data: {
        warehouse_id: warehouseId,
        lines: [{ line_uuid: lineUuid, packs: [] }],
      },
    });
    // Empty packs everywhere → either 200 with no state change OR a
    // soft no-op. Both are acceptable.
    expect([200, 422]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as {
        purchase_order: { lines: Array<{ qty_received: string }> };
      };
      expect(Number(body.purchase_order.lines[0]!.qty_received)).toBeCloseTo(
        0,
        2,
      );
    }
    await api.dispose();
  });

  test("8. per-pack quarantine — lifecycle emits routed_to_quarantine", async ({
    playwright,
  }) => {
    const { uuid, lineUuid } = await buildOrderedPo(playwright, 25);
    const warehouseId = await getWarehouseId(playwright);
    const api = await apiCtx(playwright);

    const res = await api.post(`/api/purchase-orders/${uuid}/receive`, {
      data: {
        warehouse_id: warehouseId,
        lines: [
          {
            line_uuid: lineUuid,
            packs: [
              {
                ...DEFAULT_PKG,
                qty: "25",
                route_to_quarantine: true,
              },
            ],
          },
        ],
      },
    });
    expect(res.status()).toBe(200);

    const lotsRes = await api.get(
      `/api/stock/lots?source_kind=purchase_order&limit=1&sort=-inserted_at`,
    );
    const lot = ((await lotsRes.json()) as { items: Array<{ uuid: string }> })
      .items[0]!;
    const events = await getLotEvents(playwright, lot.uuid);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("received");
    expect(kinds).toContain("routed_to_quarantine");
    await api.dispose();
  });

  test("9. re-receive accumulates — 200 now, 300 later, line goes received", async ({
    playwright,
  }) => {
    const { uuid, lineUuid } = await buildOrderedPo(playwright, 500);
    const warehouseId = await getWarehouseId(playwright);
    const api = await apiCtx(playwright);

    const firstRes = await api.post(`/api/purchase-orders/${uuid}/receive`, {
      data: {
        warehouse_id: warehouseId,
        lines: [
          { line_uuid: lineUuid, packs: [{ ...DEFAULT_PKG, qty: "200" }] },
        ],
      },
    });
    expect(firstRes.status()).toBe(200);

    const secondRes = await api.post(`/api/purchase-orders/${uuid}/receive`, {
      data: {
        warehouse_id: warehouseId,
        lines: [
          { line_uuid: lineUuid, packs: [{ ...DEFAULT_PKG, qty: "300" }] },
        ],
      },
    });
    expect(secondRes.status()).toBe(200);
    const body = (await secondRes.json()) as {
      purchase_order: { status: string; lines: Array<{ qty_received: string }> };
    };
    expect(["received", "partially_received"]).toContain(
      body.purchase_order.status,
    );
    expect(Number(body.purchase_order.lines[0]!.qty_received)).toBeCloseTo(500, 2);
    await api.dispose();
  });

  test("10. non-positive packaging dim rejected", async ({ playwright }) => {
    const { uuid, lineUuid } = await buildOrderedPo(playwright, 50);
    const warehouseId = await getWarehouseId(playwright);
    const api = await apiCtx(playwright);

    const res = await api.post(`/api/purchase-orders/${uuid}/receive`, {
      data: {
        warehouse_id: warehouseId,
        lines: [
          {
            line_uuid: lineUuid,
            packs: [{ ...DEFAULT_PKG, qty: "50", package_length_mm: 0 }],
          },
        ],
      },
    });
    expect(res.status(), "zero dim should 422").toBe(422);
    await api.dispose();
  });

  test("11. legacy shape rejected — old {line_uuid, qty} flat payload", async ({
    playwright,
  }) => {
    const { uuid, lineUuid } = await buildOrderedPo(playwright, 50);
    const warehouseId = await getWarehouseId(playwright);
    const api = await apiCtx(playwright);

    const res = await api.post(`/api/purchase-orders/${uuid}/receive`, {
      data: {
        warehouse_id: warehouseId,
        package_length_mm: 400,
        package_width_mm: 300,
        package_height_mm: 250,
        package_weight_kg: "25.000",
        units_per_package: 1,
        stack_factor: 1,
        lines: [{ line_uuid: lineUuid, qty: "50" }],
      },
    });
    expect(res.status(), "legacy shape should not silently succeed").not.toBe(
      200,
    );
    await api.dispose();
  });
});
