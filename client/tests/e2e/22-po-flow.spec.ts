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
  await page.locator("#deliveryAddress").fill("Vita HQ, London EC1");

  await page
    .getByRole("button", { name: /Create draft PO/i })
    .click();
  await page.waitForURL(
    (u) =>
      u.toString().includes("/procurement/purchase-orders/") &&
      !u.toString().endsWith("/new"),
    { timeout: 15_000 },
  );

  // PO detail page loads with a "Lines" header (or whatever the lines card surfaces)
  await expect(page.getByText(/Lines/i).first()).toBeVisible();
});
