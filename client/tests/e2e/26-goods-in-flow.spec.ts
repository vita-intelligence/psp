import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { apiCtx } from "./helpers/fixtures";

/**
 * Goods-In Inspection end-to-end smoke. BRCGS / FSSC 22000 incoming-
 * inspection workflow: draft → fill sections → line decisions → sign
 * operator → sign quality approver (different user; segregation of
 * duties) → lots transition out of quarantine via fan-out events.
 *
 * Mobile UI ships in D.3c; this spec drives the API directly so the
 * compliance contract gets locked in before the wizard work begins.
 */

const BACKEND_URL = process.env.E2E_BACKEND_URL || "http://localhost:4000";

function altToken(): string {
  const state = JSON.parse(fs.readFileSync(".auth/alt.json", "utf-8")) as {
    cookies: Array<{ name: string; value: string }>;
  };
  return state.cookies.find((c) => c.name === "psp_session")?.value ?? "";
}

async function buildOrderedPoWithLine(
  playwright: Parameters<Parameters<typeof test>[1]>[0]["playwright"],
  qty: number,
): Promise<{
  poUuid: string;
  lineUuid: string;
  lineId: number;
  vendorId: number;
  itemId: number;
}> {
  const api = await apiCtx(playwright);
  const vData = (await (
    await api.get(
      "/api/vendors?limit=10&approval_status=approved&is_active=true",
    )
  ).json()) as { items: Array<{ id: number; uuid: string }> };
  const iData = (await (await api.get("/api/items?limit=10")).json()) as {
    items: Array<{ id: number }>;
  };
  const vendor = vData.items[0]!;
  const item = iData.items[0]!;

  await api.post(`/api/vendors/${vendor.uuid}/approved-items`, {
    data: { item_id: item.id },
  });
  const create = (await (
    await api.post("/api/purchase-orders", {
      data: {
        vendor_id: vendor.id,
        currency_code: "GBP",
        discount_pct: "0",
        tax_rate: "0",
        shipping_fees: "0",
        additional_fees: "0",
        lines: [
          { item_id: item.id, qty_ordered: String(qty), unit_price: "1" },
        ],
      },
    })
  ).json()) as {
    purchase_order: {
      uuid: string;
      lines: Array<{ uuid: string; id: number }>;
    };
  };
  const poUuid = create.purchase_order.uuid;
  const line = create.purchase_order.lines[0]!;

  const submitRes = await api.post(`/api/purchase-orders/${poUuid}/submit`);
  if (submitRes.status() !== 200) {
    test.skip(true, `submit ${submitRes.status()} — vendor approved-items race`);
  }
  await api.post(`/api/purchase-orders/${poUuid}/approve`, {
    data: { notes: "E2E approver" },
  });
  await api.post(`/api/purchase-orders/${poUuid}/director-approve`, {
    data: { notes: "E2E director" },
    headers: { Authorization: `Bearer ${altToken()}` },
  });
  await api.post(`/api/purchase-orders/${poUuid}/mark-ordered`);
  await api.dispose();
  return {
    poUuid,
    lineUuid: line.uuid,
    lineId: line.id,
    vendorId: vendor.id,
    itemId: item.id,
  };
}

const SECTION_KEYS = [
  "vehicle_inspection",
  "documentation_verification",
  "physical_inspection",
  "food_safety_checks",
  "storage_verification",
] as const;

async function fillEveryChecklistSection(
  api: Awaited<ReturnType<typeof apiCtx>>,
  inspectionUuid: string,
) {
  for (const section of SECTION_KEYS) {
    const res = await api.patch(
      `/api/goods-in-inspections/${inspectionUuid}`,
      {
        data: {
          section,
          value: {
            primary_check: { passed: true, notes: "OK" },
          },
        },
      },
    );
    expect(
      res.status(),
      `PATCH section ${section} should accept the payload`,
    ).toBe(200);
  }
}

test.describe("Goods-In Inspection workflow", () => {
  test("happy path — draft → sections → line decision → operator sign → approver sign → lots qc_passed", async ({
    playwright,
  }) => {
    const { poUuid, lineUuid } = await buildOrderedPoWithLine(playwright, 50);
    const api = await apiCtx(playwright);

    // 0. Receive against PO (auto-quarantines). For the lots to fan
    //    out the qc_passed event from the inspection we must include
    //    the inspection id on the receive call — so we create the
    //    draft first, then receive with goods_in_inspection_id set.

    const draftRes = await api.post(
      `/api/purchase-orders/${poUuid}/goods-in-inspections`,
      {
        data: {
          delivery_date: "2026-06-11",
          transport_company: "E2E Logistics",
          vehicle_registration: "AB12 XYZ",
        },
      },
    );
    expect(draftRes.status(), "draft create should 201").toBe(201);
    const draft = (await draftRes.json()) as {
      goods_in_inspection: { id: number; uuid: string; status: string };
    };
    const insp = draft.goods_in_inspection;
    expect(insp.status).toBe("draft");

    // Receive 50 against the PO, stamping the inspection FK on lots
    const warehouses = (await (
      await api.get("/api/warehouses?limit=1")
    ).json()) as { items: Array<{ id: number }> };
    const recvRes = await api.post(`/api/purchase-orders/${poUuid}/receive`, {
      data: {
        warehouse_id: warehouses.items[0]!.id,
        goods_in_inspection_id: insp.id,
        lines: [
          {
            line_uuid: lineUuid,
            packs: [
              {
                qty: "50",
                package_length_mm: 400,
                package_width_mm: 300,
                package_height_mm: 250,
                package_weight_kg: "25.000",
                units_per_package: 2,
                stack_factor: 1,
              },
            ],
          },
        ],
      },
    });
    expect(recvRes.status(), "receive should 200").toBe(200);

    // 1. Fill all 5 checklist sections
    await fillEveryChecklistSection(api, insp.uuid);

    // 2. Decide on each line (one line here — accept)
    const itemRes = await api.post(
      `/api/goods-in-inspections/${insp.uuid}/items/${lineUuid}`,
      {
        data: {
          qty_received: "50",
          packaging_condition: "good",
          material_decision: "accept",
        },
      },
    );
    expect(itemRes.status()).toBe(200);

    // 3. Sign as operator
    const opRes = await api.post(
      `/api/goods-in-inspections/${insp.uuid}/sign-operator`,
      {
        data: { signature_image: "data:image/png;base64,iVBORw0KG" },
      },
    );
    expect(opRes.status(), "operator-sign should 200").toBe(200);
    const opBody = (await opRes.json()) as {
      goods_in_inspection: { status: string };
    };
    expect(opBody.goods_in_inspection.status).toBe("submitted");

    // 4. Sign as quality approver — as the ALT user (different from
    //    the host who signed as operator); segregation of duties.
    const qaRes = await api.post(
      `/api/goods-in-inspections/${insp.uuid}/sign-quality`,
      {
        data: {
          signature_image: "data:image/png;base64,iVBORw0KG",
          quality_decision: "approved",
        },
        headers: { Authorization: `Bearer ${altToken()}` },
      },
    );
    expect(qaRes.status(), `quality-sign should 200, got ${qaRes.status()}`).toBe(
      200,
    );
    const qaBody = (await qaRes.json()) as {
      goods_in_inspection: { status: string; quality_decision: string };
    };
    expect(qaBody.goods_in_inspection.status).toBe("approved");
    expect(qaBody.goods_in_inspection.quality_decision).toBe("approved");

    // 5. The linked lot should now be `available` (qc_passed event
    //    fanned out via the inspection sign-off).
    const lotsRes = await api.get(
      `/api/stock/lots?source_kind=purchase_order&limit=5&sort=-inserted_at`,
    );
    const lots = ((await lotsRes.json()) as {
      items: Array<{ uuid: string; status: string }>;
    }).items;
    expect(lots[0]?.status, "lot should leave quarantine").toBe("available");

    await api.dispose();
  });

  test("same user may sign both operator + approver under our regulatory framework", async ({
    playwright,
  }) => {
    const { poUuid, lineUuid } = await buildOrderedPoWithLine(playwright, 20);
    const api = await apiCtx(playwright);

    const draftRes = await api.post(
      `/api/purchase-orders/${poUuid}/goods-in-inspections`,
      { data: { delivery_date: "2026-06-11" } },
    );
    const insp = ((await draftRes.json()) as {
      goods_in_inspection: { id: number; uuid: string };
    }).goods_in_inspection;

    await fillEveryChecklistSection(api, insp.uuid);

    await api.post(
      `/api/goods-in-inspections/${insp.uuid}/items/${lineUuid}`,
      {
        data: {
          qty_received: "20",
          packaging_condition: "good",
          material_decision: "accept",
        },
      },
    );

    await api.post(`/api/goods-in-inspections/${insp.uuid}/sign-operator`, {
      data: { signature_image: "data:image/png;base64,iVBORw0KG" },
    });

    // Same token signs as quality approver — accepted. Our regulatory
    // framework permits a single qualified user to carry both roles;
    // the FE banner ("Review and approve" panel) flags the dual-sign
    // explicitly for the audit trail.
    const sameSignerRes = await api.post(
      `/api/goods-in-inspections/${insp.uuid}/sign-quality`,
      {
        data: {
          signature_image: "data:image/png;base64,iVBORw0KG",
          quality_decision: "approved",
        },
      },
    );
    expect(sameSignerRes.status(), "same signer should now be allowed").toBe(
      200,
    );
    const body = (await sameSignerRes.json()) as {
      goods_in_inspection: {
        status: string;
        quality_decision: string | null;
        goods_in_operator: { id: number } | null;
        quality_approver: { id: number } | null;
      };
    };
    expect(body.goods_in_inspection.status).toBe("approved");
    expect(body.goods_in_inspection.quality_decision).toBe("approved");
    // Both signature fields land on the SAME user — that's the whole
    // point of this test now.
    expect(body.goods_in_inspection.goods_in_operator?.id).toEqual(
      body.goods_in_inspection.quality_approver?.id,
    );
    await api.dispose();
  });
});
