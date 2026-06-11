import { test, expect } from "@playwright/test";
import { apiCtx } from "./helpers/fixtures";

/**
 * Stock end-to-end: manual receive form (compliance — source_kind /
 * status / QC dropdowns must be gone), then a lifecycle event POST
 * against the resulting lot to verify the state machine transitions.
 */

test.use({ storageState: ".auth/laptop.json" });

test("stock receive — form does NOT expose source_kind, status, or QC dropdowns", async ({
  page,
}) => {
  await page.goto("/stock/lots/new");

  // Compliance bypass dropdowns must not exist
  await expect(page.locator("#source_kind")).toHaveCount(0);
  await expect(page.locator("#status")).toHaveCount(0);
  await expect(page.locator("#allergen_status")).toHaveCount(0);
  await expect(page.locator("#coa_status")).toHaveCount(0);
  await expect(page.locator("#quality_status")).toHaveCount(0);

  // The compliance-state explainer card replaces them
  await expect(
    page.getByText(/New lots land with QC pending/i),
  ).toBeVisible();

  // Country of origin is now the ISO 3166 picker
  const countryPicker = page.locator("#country_of_origin");
  await expect(countryPicker).toBeVisible();
  await countryPicker.click();
  await page.locator('input[placeholder*="Search country"]').fill("United Kingdom");
  await page.getByText(/United Kingdom/i).first().click();
});

test("stock receive — manual create produces a lot with lifecycle events", async ({
  page,
  playwright,
}) => {
  await page.goto("/stock/lots/new");

  // Pick first item (Radix Select rendered as combobox)
  const itemCombo = page.getByRole("combobox").first();
  await itemCombo.click();
  const firstItem = page.getByRole("option").first();
  await expect(firstItem).toBeVisible();
  await firstItem.click();
  await expect(page.getByRole("option")).toHaveCount(0);

  // Pick first warehouse
  const siteCombo = page.getByRole("combobox").nth(1);
  await siteCombo.scrollIntoViewIfNeeded();
  await siteCombo.click();
  const firstSite = page.getByRole("option").first();
  await expect(firstSite).toBeVisible();
  await firstSite.click();
  await expect(page.getByRole("option")).toHaveCount(0);

  // Quantity
  await page.locator("#qty_received").fill("7");

  // Packaging dims — required
  await page.locator("#package_length_mm").fill("400");
  await page.locator("#package_width_mm").fill("300");
  await page.locator("#package_height_mm").fill("250");
  await page.locator("#package_weight_kg").fill("5");
  await page.locator("#units_per_package").fill("1");
  await page.locator("#stack_factor").fill("1");

  const submit = page.getByRole("button", { name: /Create lot|Receive/i });
  await expect(submit).toBeEnabled();
  await submit.click();

  // Lands on /stock/lots after the action server-action succeeds
  await page.waitForURL((u) => u.toString().includes("/stock/lots"), {
    timeout: 15_000,
  });

  // Pull the newest lot via API and verify a "received" lifecycle event
  // exists for it (the lifecycle service stamps it inside the create
  // transaction).
  const api = await apiCtx(playwright);
  const res = await api.get("/api/stock/lots?limit=1&sort=-inserted_at");
  const data = (await res.json()) as {
    items?: Array<{ uuid: string; source_kind: string }>;
  };
  const lot = data.items?.[0];
  expect(lot, "newest lot should be findable").toBeTruthy();
  expect(lot!.source_kind, "manual receive should stamp source_kind=manual").toBe(
    "manual",
  );

  const eventsRes = await api.get(`/api/stock/lots/${lot!.uuid}/events`);
  expect(eventsRes.status(), `events endpoint should respond 200`).toBe(200);
  const eventsBody = (await eventsRes.json()) as {
    items?: Array<{ kind: string }>;
  };
  expect(eventsBody.items, "events list should exist").toBeTruthy();
  expect(
    eventsBody.items!.some((e) => e.kind === "received"),
    "received event should exist for the new lot",
  ).toBe(true);
  await api.dispose();
});

test("stock lifecycle — POST hold event then release event transitions cleanly", async ({
  playwright,
}) => {
  const api = await apiCtx(playwright);
  const lots = await api.get("/api/stock/lots?limit=10");
  const data = (await lots.json()) as {
    items?: Array<{ uuid: string; status: string }>;
  };
  // Find a lot that's in a status that allows `held`
  const candidate = data.items?.find(
    (l) =>
      l.status === "received" ||
      l.status === "quarantine" ||
      l.status === "available",
  );
  test.skip(!candidate, "no lot in a hold-able state");

  const heldRes = await api.post(
    `/api/stock/lots/${candidate!.uuid}/events`,
    {
      data: { kind: "held", reason: "E2E lifecycle test" },
    },
  );
  expect(
    [200, 201].includes(heldRes.status()),
    `held event should be accepted (got ${heldRes.status()})`,
  ).toBe(true);

  const releasedRes = await api.post(
    `/api/stock/lots/${candidate!.uuid}/events`,
    {
      data: { kind: "released", reason: "E2E lifecycle test — release" },
    },
  );
  expect(
    [200, 201].includes(releasedRes.status()),
    `released event should be accepted (got ${releasedRes.status()})`,
  ).toBe(true);

  await api.dispose();
});
