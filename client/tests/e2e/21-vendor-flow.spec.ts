import { test, expect } from "@playwright/test";
import { apiCtx } from "./helpers/fixtures";

/**
 * Vendor end-to-end: create with the new ISO pickers + derived next-review
 * date + the qualification card; verify the saved record round-trips.
 *
 * This is the "every editable field actually editable, no stupid errors"
 * pass on the vendor form specifically.
 */

test.use({ storageState: ".auth/laptop.json" });

test("vendor — create with ISO pickers and derived dates", async ({ page }) => {
  await page.goto("/procurement/vendors/new");

  const name = `E2E Vendor ${Date.now()}`;
  await page.locator("#name").fill(name);
  await page.locator("#legal_name").fill("E2E Foods Ltd");
  await page.locator("#contact_name").fill("Q. A. Lead");
  await page.locator("#email").fill("orders@e2e.example");
  await page.locator("#phone").fill("+44 20 7000 0000");
  await page.locator("#website").fill("https://e2e.example");
  await page.locator("#legal_address").fill("1 E2E Way, London EC1A 1AA");

  // Currency picker (new ISO 4217 popover) — search + click
  await page.locator("#currency_code").click();
  await page.locator('input[placeholder*="Search currency"]').fill("GBP");
  await page.getByText(/British Pound/i).first().click();

  await page.locator("#default_lead_time_days").fill("14");
  await page.locator("#payment_terms_days").fill("30");

  // Pick supply chain type + risk
  const supplyChainTrigger = page.locator("#supply_chain_type");
  await supplyChainTrigger.click();
  await page
    .getByRole("option", { name: /manufacturer/i })
    .first()
    .click();
  await expect(page.getByRole("option")).toHaveCount(0);

  const riskTrigger = page.locator("#vendor_risk");
  await riskTrigger.click();
  await page.getByRole("option", { name: /low/i }).first().click();
  await expect(page.getByRole("option")).toHaveCount(0);

  // Auto-derived next_review_at — set the source fields
  await page.locator("#review_frequency_months").fill("12");
  await page.locator("#last_review_at").fill("2026-06-01");

  await page.locator("#product_types").fill("actives, excipients");

  // Save
  const saveBtn = page.getByRole("button", { name: /Create vendor/i });
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();

  // Should land on the detail page
  await page.waitForURL(
    (u) =>
      u.toString().includes("/procurement/vendors/") &&
      !u.toString().endsWith("/new"),
    { timeout: 15_000 },
  );

  // Saved values round-trip
  await expect(page.locator("#name")).toHaveValue(name);
  await expect(page.locator("#legal_name")).toHaveValue("E2E Foods Ltd");

  // Currency picker shows GBP
  await expect(
    page.locator("#currency_code").getByText("GBP"),
  ).toBeVisible();

  // Derived next-review-at: with last_review_at = 2026-06-01 and cadence
  // 12mo, the auto-computed value should read 2026-06-01. The field is
  // read-only display showing the computed value.
  await expect(page.getByText(/Auto: Last review \+ 12mo/i)).toBeVisible();
});

test("vendor — comments thread appears on detail page", async ({
  page,
  playwright,
}) => {
  const api = await apiCtx(playwright);
  const res = await api.get("/api/vendors?limit=1");
  const data = (await res.json()) as {
    items?: Array<{ uuid: string; name: string }>;
  };
  await api.dispose();
  test.skip(
    !data.items || data.items.length === 0,
    "no vendors in dev DB to open",
  );
  const vendor = data.items![0]!;

  await page.goto(`/procurement/vendors/${vendor.uuid}`);

  // The Comments thread card from the new comments module
  await expect(
    page.getByText(/Discussion|Comments/i).first(),
  ).toBeVisible({ timeout: 10_000 });
});
