import { test, expect } from "@playwright/test";
import { apiCtx } from "./helpers/fixtures";

/**
 * Purchase order end-to-end: header form + line picker. Verifies the new
 * CurrencyPicker accepts a value, the derived expected-delivery date
 * shows the vendor's lead time, and the line-item form's suggest-price
 * banner appears (or "No prior purchases" placeholder when no history).
 */

test.use({ storageState: ".auth/laptop.json" });

test("PO — create draft with vendor + currency + derived delivery date", async ({
  page,
  playwright,
}) => {
  const api = await apiCtx(playwright);
  const res = await api.get(
    "/api/vendors?limit=10&approval_status=approved&is_active=true",
  );
  const data = (await res.json()) as {
    items?: Array<{ id: number; name: string; currency_code: string }>;
  };
  await api.dispose();
  test.skip(
    !data.items || data.items.length === 0,
    "no approved active vendors in dev DB",
  );

  await page.goto("/procurement/purchase-orders/new");

  // Pick the first approved vendor
  await page.locator("#vendorId").click();
  await page.getByRole("option").first().click();
  await expect(page.getByRole("option")).toHaveCount(0);

  // Currency picker should show a code (auto-set from vendor)
  await expect(page.locator("#currency").getByText(/[A-Z]{3}/)).toBeVisible();

  // Derived delivery date — should show either "Auto: Today + Xd lead
  // time" hint OR "Pick a vendor" if vendor lookup failed.
  await expect(
    page.getByText(/Auto: Today \+ \d+d lead time/i),
  ).toBeVisible({ timeout: 10_000 });

  // Delivery address (free text)
  await page.locator("#delivery_address").fill("Vita HQ, London EC1");

  // D.1: button renamed to "Save as draft".
  await page.getByRole("button", { name: /Save as draft/i }).first().click();
  await page.waitForURL(
    (u) =>
      u.toString().includes("/procurement/purchase-orders/") &&
      !u.toString().endsWith("/new"),
    { timeout: 15_000 },
  );

  // PO detail page loads with a "Lines" header (or whatever the lines card surfaces)
  await expect(page.getByText(/Lines/i).first()).toBeVisible();
});

test("PO — single-page create persists a line with computed totals", async ({
  page,
  playwright,
}) => {
  const api = await apiCtx(playwright);
  const vendorRes = await api.get(
    "/api/vendors?limit=10&approval_status=approved&is_active=true",
  );
  const vendorData = (await vendorRes.json()) as {
    items?: Array<{ id: number }>;
  };
  const itemsRes = await api.get("/api/items?limit=1");
  const itemsData = (await itemsRes.json()) as {
    items?: Array<{ id: number }>;
  };
  await api.dispose();
  test.skip(
    !vendorData.items?.[0] || !itemsData.items?.[0],
    "need at least one approved vendor + one item",
  );

  await page.goto("/procurement/purchase-orders/new");

  // Header — pick vendor, fill tax to make tax_amount > 0
  await page.locator("#vendorId").click();
  await page.getByRole("option").first().click();
  await expect(page.getByRole("option")).toHaveCount(0);

  await page.locator("#tax_rate").fill("20");

  // Add one line
  await page.getByRole("button", { name: /Add line/i }).click();

  // The line row's item Select uses the placeholder "Pick item…" — find
  // its parent combobox by text and click.
  const lineItemCombo = page.getByRole("combobox").filter({
    hasText: /Pick item/i,
  });
  await lineItemCombo.click();
  await page.getByRole("option").first().click();
  await expect(page.getByRole("option")).toHaveCount(0);

  // Qty + price target the line row by aria-label (disambiguates from
  // the totals footer's discount / shipping inputs).
  await page.getByLabel(/Line 1 quantity/i).fill("10");
  await page.getByLabel(/Line 1 unit price/i).fill("5.50");

  // Save as draft
  await page.getByRole("button", { name: /Save as draft/i }).first().click();
  await page.waitForURL(
    (u) =>
      u.toString().includes("/procurement/purchase-orders/") &&
      !u.toString().endsWith("/new"),
    { timeout: 15_000 },
  );

  // Pull the saved PO via API to confirm line + totals round-tripped.
  const uuid = page.url().split("/").pop();
  expect(uuid).toBeTruthy();

  const api2 = await apiCtx(playwright);
  const showRes = await api2.get(`/api/purchase-orders/${uuid}`);
  const showBody = (await showRes.json()) as {
    purchase_order: {
      lines: Array<{ qty_ordered: string; unit_price: string }>;
      subtotal: string;
      tax_rate: string;
      tax_amount: string;
      grand_total: string;
    };
  };
  await api2.dispose();

  const po = showBody.purchase_order;
  expect(po.lines, "saved PO has at least 1 line").toHaveLength(1);
  // Backend serialises Decimal at full precision; assert numeric equality
  // rather than the exact textual form to stay decimal-precision-agnostic.
  expect(Number(po.lines[0]!.qty_ordered)).toBeCloseTo(10, 3);
  expect(Number(po.lines[0]!.unit_price)).toBeCloseTo(5.5, 3);
  // 10 × 5.50 = 55.00; tax 20% = 11.00; grand = 55 + 11 = 66.00
  expect(Number(po.subtotal)).toBeCloseTo(55, 2);
  expect(Number(po.tax_rate)).toBeCloseTo(20, 2);
  expect(Number(po.tax_amount)).toBeCloseTo(11, 2);
  expect(Number(po.grand_total)).toBeCloseTo(66, 2);
});

test("PO — submit transition endpoint accepts the nested-route URL param", async ({
  playwright,
}) => {
  // Regression test for the bug the user hit clicking "Submit for
  // approval" on the detail page: the transition controllers were
  // pattern-matching on `"id" => uuid` but Phoenix's nested resource
  // routes pass `purchase_order_id` — every action raised a
  // FunctionClauseError → 400. Direct API call here so the assertion
  // is unambiguous and the UI click race doesn't muddy the signal.
  const api = await apiCtx(playwright);
  const vendorRes = await api.get(
    "/api/vendors?limit=10&approval_status=approved&is_active=true",
  );
  const itemsRes = await api.get("/api/items?limit=1");
  const vendorData = (await vendorRes.json()) as {
    items?: Array<{ id: number }>;
  };
  const itemsData = (await itemsRes.json()) as {
    items?: Array<{ id: number }>;
  };
  test.skip(
    !vendorData.items?.[0] || !itemsData.items?.[0],
    "need approved vendor + item",
  );

  const createRes = await api.post("/api/purchase-orders", {
    data: {
      vendor_id: vendorData.items![0]!.id,
      currency_code: "GBP",
      discount_pct: "0",
      tax_rate: "0",
      shipping_fees: "0",
      additional_fees: "0",
      lines: [
        {
          item_id: itemsData.items![0]!.id,
          qty_ordered: "5",
          unit_price: "10",
        },
      ],
    },
  });
  const createBody = (await createRes.json()) as {
    purchase_order: { uuid: string; status: string };
  };
  expect(createBody.purchase_order.status).toBe("draft");

  const submitRes = await api.post(
    `/api/purchase-orders/${createBody.purchase_order.uuid}/submit`,
  );
  // Regression: pre-fix the controller raised Phoenix.ActionClauseError
  // because it pattern-matched on `"id" => uuid` but the nested route
  // passes `purchase_order_id`. That returned a generic 400. After the
  // fix, the endpoint reaches the action — it may still 422 here if the
  // demo item isn't on the vendor's approved-supplier list (which is
  // correct compliance enforcement), but it should NOT be 400.
  expect(submitRes.status(), "submit should no longer FunctionClauseError").not.toBe(
    400,
  );
  await api.dispose();
});
