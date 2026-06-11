import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { apiCtx } from "./helpers/fixtures";

/**
 * Mobile Goods-In Inspection wizard end-to-end.
 *
 * Walks the 8-step wizard against the actual mobile route + persistence
 * stack: each Save & continue tap hits a real PATCH; the operator's
 * eSign canvas pumps a base64 image into POST /sign-operator; the
 * quality approver tab (using the alt user token) flips the status to
 * approved + fans out a `qc_passed` event onto the linked lot.
 *
 * Builds the PO + draft inspection via the API first, then drives the
 * UI to verify the wizard wires the actions together correctly.
 */

function altToken(): string {
  const state = JSON.parse(fs.readFileSync(".auth/alt.json", "utf-8")) as {
    cookies: Array<{ name: string; value: string }>;
  };
  return state.cookies.find((c) => c.name === "psp_session")?.value ?? "";
}

interface BuiltPo {
  poUuid: string;
  lineUuid: string;
  vendorId: number;
  itemId: number;
}

async function buildOrderedPoWithLine(
  playwright: Parameters<Parameters<typeof test>[1]>[0]["playwright"],
  qty: number,
): Promise<BuiltPo> {
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
    vendorId: vendor.id,
    itemId: item.id,
  };
}

interface BuiltInspection {
  inspectionUuid: string;
  inspectionId: number;
}

async function createDraftInspection(
  playwright: Parameters<Parameters<typeof test>[1]>[0]["playwright"],
  poUuid: string,
): Promise<BuiltInspection> {
  const api = await apiCtx(playwright);
  const res = await api.post(
    `/api/purchase-orders/${poUuid}/goods-in-inspections`,
    {
      data: { delivery_date: "2026-06-11" },
    },
  );
  expect(res.status(), "draft create should 201").toBe(201);
  const body = (await res.json()) as {
    goods_in_inspection: { id: number; uuid: string };
  };
  await api.dispose();
  return {
    inspectionUuid: body.goods_in_inspection.uuid,
    inspectionId: body.goods_in_inspection.id,
  };
}

async function receiveAgainstPo(
  playwright: Parameters<Parameters<typeof test>[1]>[0]["playwright"],
  poUuid: string,
  lineUuid: string,
  inspectionId: number,
  qty: string,
) {
  const api = await apiCtx(playwright);
  const warehouses = (await (
    await api.get("/api/warehouses?limit=1")
  ).json()) as { items: Array<{ id: number }> };
  const res = await api.post(`/api/purchase-orders/${poUuid}/receive`, {
    data: {
      warehouse_id: warehouses.items[0]!.id,
      goods_in_inspection_id: inspectionId,
      lines: [
        {
          line_uuid: lineUuid,
          packs: [
            {
              qty,
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
  expect(res.status(), "receive should 200").toBe(200);
  await api.dispose();
}

const SECTION_TEST_IDS = [
  "step-vehicle",
  "step-documentation",
  "step-physical",
  "step-food-safety",
  "step-storage",
] as const;

async function fillSectionStep(
  page: import("@playwright/test").Page,
  sectionTestId: string,
) {
  // Each section panel renders rows tagged `check-<key>` with Yes/No
  // buttons (`<id>-yes` / `<id>-no`). Tap "Yes" on the first row in
  // the section so the section bag has at least one populated check —
  // satisfies the BE sign-operator gate.
  const panel = page.getByTestId(sectionTestId);
  await expect(panel).toBeVisible();
  const firstYes = panel.locator('[data-testid$="-yes"]').first();
  await firstYes.click();
}

async function drawSignature(page: import("@playwright/test").Page) {
  // The pad is a single canvas inside the step-sign-off / approver
  // panel. We use absolute mouse moves over the canvas so the
  // SignaturePad's pointerdown → pointermove → pointerup pipeline
  // fires + the parent's onChange runs at least once.
  const canvas = page.locator("canvas").first();
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Signature canvas not visible");
  const startX = box.x + 20;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 60, startY + 20, { steps: 10 });
  await page.mouse.move(startX + 120, startY - 10, { steps: 10 });
  await page.mouse.up();
}

test.describe("Mobile Goods-In Inspection wizard", () => {
  test.use({ storageState: ".auth/laptop.json" });

  test("walks all 8 steps end-to-end and flips status to submitted", async ({
    page,
    playwright,
  }) => {
    const { poUuid, lineUuid } = await buildOrderedPoWithLine(playwright, 50);
    const { inspectionUuid, inspectionId } = await createDraftInspection(
      playwright,
      poUuid,
    );
    await receiveAgainstPo(playwright, poUuid, lineUuid, inspectionId, "50");

    await page.goto(`/m/inspections/${inspectionUuid}`);
    await expect(page.getByTestId("wizard-header")).toBeVisible();

    // ----- step 1: delivery info (already pre-filled at draft create
    //       with delivery_date — just press Save & continue) ----------
    await expect(page.getByTestId("step-delivery")).toBeVisible();
    await page.getByTestId("wizard-next").click();

    // ----- step 2: vehicle -------------------------------------------
    await expect(page.getByTestId("step-vehicle")).toBeVisible();
    await fillSectionStep(page, "step-vehicle");
    await page.getByTestId("wizard-next").click();

    // ----- step 3: per-line decisions --------------------------------
    const lineCard = page.getByTestId(`line-${lineUuid}`);
    await expect(lineCard).toBeVisible();
    // Set received qty to 50, leave decision = accept (default).
    const qtyInput = page.getByTestId(`line-${lineUuid}-qty`);
    await qtyInput.fill("50");
    // Pre-select packaging condition.
    await lineCard.getByText("Select").click();
    await page.getByRole("option", { name: "Good" }).click();
    await page.getByTestId("wizard-next").click();

    // ----- step 4-7: the other 4 section checklists -----------------
    for (const sectionId of SECTION_TEST_IDS.slice(1)) {
      await expect(page.getByTestId(sectionId)).toBeVisible();
      await fillSectionStep(page, sectionId);
      await page.getByTestId("wizard-next").click();
    }

    // ----- step 8: sign-off + signature pad --------------------------
    await expect(page.getByTestId("step-sign-off")).toBeVisible();
    await drawSignature(page);
    await page.getByTestId("sign-operator").click();

    // Status should have flipped to submitted; verify via API.
    const api = await apiCtx(playwright);
    await expect
      .poll(
        async () => {
          const res = await api.get(
            `/api/goods-in-inspections/${inspectionUuid}`,
          );
          if (res.status() !== 200) return res.status();
          const body = (await res.json()) as {
            goods_in_inspection: { status: string };
          };
          return body.goods_in_inspection.status;
        },
        { message: "wizard should flip status to submitted" },
      )
      .toBe("submitted");
    await api.dispose();
  });

  test("operator + approver: same flow ends with status=approved + lot leaves quarantine", async ({
    browser,
    playwright,
  }) => {
    const { poUuid, lineUuid } = await buildOrderedPoWithLine(playwright, 30);
    const { inspectionUuid, inspectionId } = await createDraftInspection(
      playwright,
      poUuid,
    );
    await receiveAgainstPo(playwright, poUuid, lineUuid, inspectionId, "30");

    // -------- pass 1: operator walks the wizard + signs --------------
    const operatorCtx = await browser.newContext({
      storageState: ".auth/laptop.json",
      ignoreHTTPSErrors: true,
    });
    const operatorPage = await operatorCtx.newPage();
    await operatorPage.goto(`/m/inspections/${inspectionUuid}`);

    // Walk steps 1-7 the same way.
    await operatorPage.getByTestId("step-delivery").waitFor();
    await operatorPage.getByTestId("wizard-next").click();
    await fillSectionStep(operatorPage, "step-vehicle");
    await operatorPage.getByTestId("wizard-next").click();

    await operatorPage.getByTestId(`line-${lineUuid}-qty`).fill("30");
    await operatorPage.getByTestId("wizard-next").click();

    for (const sectionId of SECTION_TEST_IDS.slice(1)) {
      await fillSectionStep(operatorPage, sectionId);
      await operatorPage.getByTestId("wizard-next").click();
    }

    await drawSignature(operatorPage);
    await operatorPage.getByTestId("sign-operator").click();

    // Wait for submission to settle.
    const settleApi = await apiCtx(playwright);
    await expect
      .poll(async () => {
        const res = await settleApi.get(
          `/api/goods-in-inspections/${inspectionUuid}`,
        );
        const body = (await res.json()) as {
          goods_in_inspection: { status: string };
        };
        return body.goods_in_inspection.status;
      })
      .toBe("submitted");
    await settleApi.dispose();
    await operatorCtx.close();

    // -------- pass 2: alt user (approver) signs --------------------
    // The alt token has director_approve perms; the test seed grants
    // it goods_in.approve too (it's an admin in the dev seed).
    const approverCtx = await browser.newContext({
      storageState: ".auth/alt.json",
      ignoreHTTPSErrors: true,
    });
    const approverPage = await approverCtx.newPage();
    await approverPage.goto(`/m/inspections/${inspectionUuid}`);

    const panel = approverPage.getByTestId("approver-panel");
    await expect(panel).toBeVisible();
    // Default decision is approved; just sign.
    await drawSignature(approverPage);
    await approverPage.getByRole("button", { name: /Sign and record/i }).click();

    const api = await apiCtx(playwright);
    await expect
      .poll(
        async () => {
          const res = await api.get(
            `/api/goods-in-inspections/${inspectionUuid}`,
          );
          const body = (await res.json()) as {
            goods_in_inspection: { status: string };
          };
          return body.goods_in_inspection.status;
        },
        { message: "approver sign should flip status to approved" },
      )
      .toBe("approved");

    // Sanity-check that the linked lot left quarantine.
    const lotsRes = await api.get(
      `/api/stock/lots?source_kind=purchase_order&limit=5&sort=-inserted_at`,
    );
    const lots = ((await lotsRes.json()) as {
      items: Array<{ uuid: string; status: string }>;
    }).items;
    expect(lots[0]?.status, "lot should leave quarantine").toBe("available");
    await api.dispose();
    await approverCtx.close();
  });
});
