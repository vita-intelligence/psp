import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { apiCtx } from "./helpers/fixtures";

/**
 * Mobile "Expected today" board (D.3b mobile slice).
 *
 * Two paths:
 *   1. A PO marked `ordered` with `expected_delivery_date = today`
 *      shows up on /m/incoming with the "Expected today" badge.
 *   2. Tapping a card with no open inspection creates a draft via
 *      `createDraftAction` and navigates to /m/inspections/<uuid>.
 *
 * Drives the BE via the laptop API ctx for fixture setup (same
 * pattern as 26-goods-in-flow.spec.ts), then drives the FE via the
 * phone storage state captured by 01-device-pair.
 */

// Mobile pages still authenticate via the standard session cookie —
// the device-token path is for paired tablets. Reuse the laptop session
// the auth.setup spec already provisioned.
test.use({ storageState: ".auth/laptop.json" });

function altToken(): string {
  const state = JSON.parse(fs.readFileSync(".auth/alt.json", "utf-8")) as {
    cookies: Array<{ name: string; value: string }>;
  };
  return state.cookies.find((c) => c.name === "psp_session")?.value ?? "";
}

function todayIso(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Build an `ordered` PO with one line and a chosen expected
 * delivery date. Mirrors `buildOrderedPoWithLine` in 26-goods-in-
 * flow.spec.ts but adds the date field — the mobile-incoming board
 * filters off it.
 */
async function buildOrderedPoExpected(
  playwright: Parameters<Parameters<typeof test>[1]>[0]["playwright"],
  qty: number,
  expectedDate: string,
): Promise<{
  poUuid: string;
  poCode: string;
  vendorName: string;
  lineUuid: string;
}> {
  const api = await apiCtx(playwright);
  const vData = (await (
    await api.get(
      "/api/vendors?limit=10&approval_status=approved&is_active=true",
    )
  ).json()) as {
    items: Array<{ id: number; uuid: string; name: string }>;
  };
  const iData = (await (await api.get("/api/items?limit=10")).json()) as {
    items: Array<{ id: number }>;
  };
  const vendor = vData.items[0]!;
  const item = iData.items[0]!;

  // Make sure the vendor can supply this item — otherwise submit will
  // fail the approved-supplier guard.
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
        expected_delivery_date: expectedDate,
        lines: [
          { item_id: item.id, qty_ordered: String(qty), unit_price: "1" },
        ],
      },
    })
  ).json()) as {
    purchase_order: {
      uuid: string;
      code: string;
      lines: Array<{ uuid: string }>;
    };
  };
  const poUuid = create.purchase_order.uuid;
  const poCode = create.purchase_order.code;
  const lineUuid = create.purchase_order.lines[0]!.uuid;

  const submitRes = await api.post(`/api/purchase-orders/${poUuid}/submit`);
  if (submitRes.status() !== 200) {
    test.skip(
      true,
      `submit ${submitRes.status()} — vendor approved-items race`,
    );
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
  return { poUuid, poCode, vendorName: vendor.name, lineUuid };
}

test.describe("Mobile incoming board", () => {
  test("expected today filter shows ordered POs", async ({
    page,
    playwright,
  }) => {
    const { poCode, vendorName } = await buildOrderedPoExpected(
      playwright,
      30,
      todayIso(),
    );

    await page.goto("/m/incoming");

    // The page title should land.
    await expect(
      page.getByRole("heading", { name: /Expected deliveries/i }),
    ).toBeVisible({ timeout: 10_000 });

    // The PO we just created should be visible with its code + vendor
    // + the "Expected today" badge.
    const card = page.getByRole("button", {
      name: new RegExp(`${poCode}`),
    });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText(vendorName);
    // Badge text — case-insensitive so "EXPECTED TODAY" via uppercase
    // CSS also matches.
    await expect(card).toContainText(/Expected today/i);
  });

  test("tap card with no open inspection starts a draft + navigates", async ({
    page,
    playwright,
  }) => {
    const { poUuid, poCode } = await buildOrderedPoExpected(
      playwright,
      40,
      todayIso(),
    );

    await page.goto("/m/incoming");

    const card = page.getByRole("button", {
      name: new RegExp(`${poCode}`),
    });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();

    // Server action creates the draft + we navigate into the wizard.
    // The D.3c wizard page may not have rendered fully yet, but the
    // URL change is the contract: we landed at /m/inspections/<uuid>.
    await page.waitForURL(/\/m\/inspections\/[a-f0-9-]+/, {
      timeout: 15_000,
    });

    // Cross-check via the BE: a draft inspection exists for this PO.
    const api = await apiCtx(playwright);
    const listRes = await api.get(
      `/api/purchase-orders/${poUuid}/goods-in-inspections`,
    );
    expect(listRes.status()).toBe(200);
    const body = (await listRes.json()) as {
      items: Array<{ status: string; uuid: string }>;
    };
    const drafts = body.items.filter((i) => i.status === "draft");
    expect(drafts.length).toBeGreaterThanOrEqual(1);
    await api.dispose();
  });
});
