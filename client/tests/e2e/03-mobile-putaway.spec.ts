import { test, expect } from "@playwright/test";
import fs from "node:fs";

/**
 * Phone put-away flow. Uses the storage state cached by 01-device-pair.
 *
 * Camera mode never engages in headless chromium (no videoinput), so
 * the scanner falls back to the file/manual UI and we drive it via
 * the "Type the cell URL" path. That tests the same `handle()` code
 * path the camera triggers — same uuid-extractor, same /api/m/cells
 * fetch, same wrong/confirmed/invalid branches.
 *
 * The list of real cell UUIDs comes from the laptop's authed Phoenix
 * call so we know which manual input will yield a "Scan confirmed"
 * vs which will trigger "Shelf not found".
 */
test.use({ storageState: ".auth/phone.json" });

interface CellRow {
  uuid: string;
  name: string | null;
}

let knownCells: CellRow[] = [];

test.beforeAll(async ({ playwright }) => {
  // Use the laptop's authed session to enumerate cells. The list is
  // shared across the test run; one fetch is enough.
  const laptopState = JSON.parse(
    fs.readFileSync(".auth/laptop.json", "utf-8"),
  ) as { cookies: Array<{ name: string; value: string }> };
  const sessionCookie = laptopState.cookies.find(
    (c) => c.name === "psp_session",
  );
  if (!sessionCookie) return;

  const apiCtx = await playwright.request.newContext({
    baseURL: process.env.E2E_BACKEND_URL || "http://localhost:4000",
    extraHTTPHeaders: {
      Authorization: `Bearer ${sessionCookie.value}`,
    },
  });
  const res = await apiCtx.get("/api/stock/cells?limit=50");
  if (res.ok()) {
    const body = (await res.json()) as { items: CellRow[] };
    knownCells = body.items ?? [];
  }
  await apiCtx.dispose();
});

test.describe("Mobile put-away", () => {
  test("scan-override path: wrong QR blocks; right QR advances", async ({
    page,
  }) => {
    test.skip(
      knownCells.length === 0,
      "No cells in the dev DB — create at least one shelf first.",
    );

    await page.goto("/m");
    await expect(
      page.getByRole("heading", { name: /Pending put-away/i }),
    ).toBeVisible();

    const pendingCount = await page.locator('a[href^="/m/lots/"]').count();
    test.skip(
      pendingCount === 0,
      "No pending lots — run the receive spec first to seed one.",
    );

    await page.locator('a[href^="/m/lots/"]').first().click();
    await page.getByRole("link", { name: /Move to a shelf/i }).click();

    // Skip the recommendations and go straight to the override scanner
    // — that path has no `expected`, so any valid cell URL is accepted
    // (confirmed) and anything else surfaces an `invalid` red banner.
    await page
      .getByRole("button", { name: /Scan a different shelf/i })
      .click();

    await expect(page.getByText(/Camera unavailable/i)).toBeVisible();
    await page.getByRole("button", { name: /type the cell URL/i }).click();
    const manualInput = page.getByPlaceholder(/stock\/cells/);
    await expect(manualInput).toBeVisible();

    // === Invalid UUID branch — backend lookup fails. ===
    await manualInput.fill("00000000-0000-0000-0000-000000000000");
    await page.getByRole("button", { name: /^Continue$/ }).click();
    await expect(
      page.getByText(/Shelf not found|isn't a shelf|Wrong QR code/i),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/Scan confirmed/i)).toHaveCount(0);

    // The wrong/invalid banner self-clears after ~2.2s. Wait for the
    // manual form to come back, then enter a real cell uuid.
    await page.waitForTimeout(2400);
    await expect(manualInput).toBeVisible();
    await manualInput.fill(knownCells[0].uuid);
    await page.getByRole("button", { name: /^Continue$/ }).click();

    // Either "Scan confirmed" banner (briefly) or the confirm step
    // arriving — assert the confirm screen reaches "Quantity".
    await expect(
      page.getByText(/Scan confirmed|Quantity/i).first(),
    ).toBeVisible({ timeout: 8_000 });
  });

  test("pending list is reachable", async ({ page }) => {
    await page.goto("/m");
    await expect(
      page.getByRole("heading", { name: /Pending put-away/i }),
    ).toBeVisible();
    // Even with zero rows we should see the "All clear" empty state,
    // never a 500 or a broken layout.
    const hasItems = (await page.locator('a[href^="/m/lots/"]').count()) > 0;
    if (!hasItems) {
      await expect(page.getByText(/All clear/i)).toBeVisible();
    }
  });
});
