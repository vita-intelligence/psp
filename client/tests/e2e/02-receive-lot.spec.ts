import { test, expect } from "@playwright/test";

/**
 * Receive form smoke. The fixture-DB approach: we don't assume any
 * specific item or warehouse — we pick whatever the first option in
 * each Select is. The test passes only when:
 *   - at least one item + warehouse exist
 *   - the packaging-suggestions endpoint responds without 500
 *   - submit lands us back on /stock/lots
 */
test.use({ storageState: ".auth/laptop.json" });

test.describe("Receive a manual lot", () => {
  test("happy path: pick item, fill packaging, submit", async ({ page }) => {
    await page.goto("/stock/lots/new");

    await expect(page.getByRole("heading", { name: /Create.*lot|Receive/i })).toBeVisible();

    // Both pickers are Radix Selects rendered as role=combobox.
    // Index 0 = item, 1 = warehouse. Open by index, pick the first
    // option, wait for the dropdown to fully close before moving on.
    const itemCombo = page.getByRole("combobox").nth(0);
    await itemCombo.click();
    const firstItemOption = page.getByRole("option").first();
    await expect(firstItemOption).toBeVisible();
    const itemLabel = (await firstItemOption.innerText()).trim();
    await firstItemOption.click();
    await expect(page.getByRole("option")).toHaveCount(0);

    const siteCombo = page.getByRole("combobox").nth(1);
    await siteCombo.scrollIntoViewIfNeeded();
    await siteCombo.click();
    const firstSiteOption = page.getByRole("option").first();
    await expect(firstSiteOption).toBeVisible();
    await firstSiteOption.click();
    await expect(page.getByRole("option")).toHaveCount(0);

    // Quantity
    await page.getByPlaceholder("0.00").fill("12");

    // Packaging block — fill all six required fields by their visible
    // <label> text via Field labels.
    await page.getByPlaceholder("e.g. 400").first().fill("400");
    // The second "e.g. 400" placeholder is width.
    await page.getByPlaceholder("e.g. 400").nth(1).fill("300");
    await page.getByPlaceholder("e.g. 600").fill("250");
    await page.getByPlaceholder("e.g. 25.000").fill("5.0");
    // Two "1" placeholders: units-per-package and stack-factor. Fill
    // both with a safe value.
    const onesPlaceholders = page.getByPlaceholder("1");
    await onesPlaceholders.nth(0).fill("1");
    await onesPlaceholders.nth(1).fill("1");

    const submit = page.getByRole("button", { name: /Create lot/i });
    await expect(submit).toBeEnabled();

    // Submit is a Next server action → browser POSTs to the page route,
    // not directly to /api/stock/lots/manual. Treat the navigation as
    // the success signal; a failed action stays on /stock/lots/new.
    await submit.click();
    await page.waitForURL(/\/stock\/lots(\?|$)/, { timeout: 20_000 });
    expect(itemLabel.length, "the picker yielded a non-empty item label").toBeGreaterThan(0);
  });

  test("packaging-suggestions endpoint responds for picked item", async ({
    page,
  }) => {
    const suggReq = page.waitForResponse(
      (r) =>
        r.url().includes("/packaging-suggestions") && r.request().method() === "GET",
      { timeout: 15_000 },
    );

    await page.goto("/stock/lots/new");
    await page.getByRole("combobox").nth(0).click();
    await page.getByRole("option").first().click();

    const resp = await suggReq;
    expect(resp.status()).toBeLessThan(400);
    const json = (await resp.json()) as {
      suggestions: { item_default: unknown; last_lot: unknown; average: unknown };
    };
    // Backend nests under `suggestions`. Any of the three slots may
    // be null but the keys should exist.
    expect(json).toHaveProperty("suggestions.item_default");
    expect(json).toHaveProperty("suggestions.last_lot");
    expect(json).toHaveProperty("suggestions.average");
  });
});
