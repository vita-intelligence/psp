import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end functional smoke for every form in PSP that has a "new"
 * route. For each form we:
 *
 *   1. Navigate to the /new route
 *   2. Find the primary text input (name / label / key)
 *   3. Fill a unique value
 *   4. Click the Save / Create button
 *   5. Assert success — URL changed off `/new`, no <ErrorBanner>,
 *      no Next 16 Build Error overlay, no unhandled-rejection toast
 *
 * The point: catch any field that throws when you type into it, any
 * Save handler that errors silently, any pre-existing build break that
 * blocks a route from rendering. This is the "no stupid errors when I
 * interact via UI" sweep the user asked for.
 */

test.use({ storageState: ".auth/laptop.json" });

interface FormSpec {
  /** Slug used in the test name. */
  slug: string;
  /** URL of the /new page. */
  url: string;
  /** id of the primary text input to fill. */
  primaryId: string;
  /** Optional second input (key/code). */
  secondaryId?: string;
  /** Visible name of the save button. */
  saveButton: RegExp;
  /** Where the URL goes after successful create. Substring match. */
  redirectIncludes?: string;
  /** Additional fields to fill before submit. */
  extraFields?: Array<{ id: string; value: string }>;
  /** Selects to pick on by trigger id + the option label to click. */
  picks?: Array<{ triggerId: string; option: RegExp }>;
}

// ────────────────────────────────────────────────────────────────────────
// Reusable assertions
// ────────────────────────────────────────────────────────────────────────

async function expectNoUiErrors(page: Page) {
  // Next.js dev build-error overlay
  await expect(
    page.getByText(/Build Error|Unhandled Runtime Error/i),
  ).toBeHidden();
  // App-level error banner (from <ErrorBanner>)
  await expect(
    page.locator('[role="alert"]').filter({ hasText: /Couldn't|Failed|Error/i }),
  ).toHaveCount(0);
}

async function fillById(page: Page, id: string, value: string) {
  const locator = page.locator(`#${id}`);
  await expect(locator, `#${id} should exist on the page`).toBeVisible();
  await locator.fill(value);
}

async function pickFromSelect(page: Page, triggerId: string, option: RegExp) {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole("option", { name: option }).first().click();
  await expect(page.getByRole("option")).toHaveCount(0);
}

async function clickSave(page: Page, saveButton: RegExp) {
  const btn = page.getByRole("button", { name: saveButton });
  await expect(btn, "save button should exist").toBeVisible();
  await expect(btn, "save button should be enabled").toBeEnabled();
  await btn.click();
}

// ────────────────────────────────────────────────────────────────────────
// Forms with a generic create-and-redirect pattern
// ────────────────────────────────────────────────────────────────────────

const SIMPLE_FORMS: FormSpec[] = [
  {
    slug: "warehouse",
    url: "/settings/warehouses/new",
    primaryId: "name",
    saveButton: /Create warehouse/i,
    redirectIncludes: "/settings/warehouses/",
  },
  {
    slug: "unit",
    url: "/settings/units-of-measurement/new",
    primaryId: "u-name",
    secondaryId: "u-symbol",
    saveButton: /Create unit/i,
    redirectIncludes: "/settings/units-of-measurement",
    // Default dimension is "Mass" with kg as base; factor 1 would
    // duplicate kg, so use a per-run unique factor.
    extraFields: [
      { id: "u-factor", value: `0.${Date.now()}`.slice(0, 8) },
    ],
  },
  {
    slug: "role-template",
    url: "/settings/roles/new",
    primaryId: "name",
    saveButton: /Create template/i,
    redirectIncludes: "/settings/roles",
  },
  {
    slug: "certificate",
    url: "/settings/certificates/new",
    primaryId: "c-name",
    saveButton: /Create certificate/i,
    redirectIncludes: "/settings/certificates",
  },
  {
    slug: "product-family",
    url: "/settings/product-families/new",
    primaryId: "pf-name",
    saveButton: /Create family/i,
    redirectIncludes: "/settings/product-families",
  },
  {
    slug: "storage-tag",
    url: "/settings/storage-tags/new",
    primaryId: "t-label",
    secondaryId: "t-key",
    saveButton: /Create tag/i,
    redirectIncludes: "/settings/storage-tags",
  },
];

test.describe("Form smoke — simple settings forms create + redirect", () => {
  for (const form of SIMPLE_FORMS) {
    test(form.slug, async ({ page }) => {
      await page.goto(form.url);

      // Form rendered cleanly
      await expectNoUiErrors(page);

      const unique = `E2E ${form.slug} ${Date.now()}`;
      // Symbol / key fields often enforce alphanumeric-only AND short
      // length constraints (unit symbol is capped at 12 chars). Take the
      // last 8 digits of the timestamp so each run gets a fresh value
      // that comfortably fits.
      const safeUnique =
        "e" + String(Date.now()).slice(-8) + Math.floor(Math.random() * 9);

      await fillById(page, form.primaryId, unique);
      if (form.secondaryId) {
        await fillById(page, form.secondaryId, safeUnique);
      }

      if (form.picks) {
        for (const pick of form.picks) {
          await pickFromSelect(page, pick.triggerId, pick.option);
        }
      }
      if (form.extraFields) {
        for (const f of form.extraFields) {
          await fillById(page, f.id, f.value);
        }
      }

      await clickSave(page, form.saveButton);

      // Successful create either navigates off /new or refreshes inline.
      if (form.redirectIncludes) {
        await page.waitForURL(
          (u) =>
            u.toString().includes(form.redirectIncludes!) &&
            !u.toString().endsWith("/new"),
          { timeout: 10_000 },
        );
      }

      await expectNoUiErrors(page);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────
// Forms that need a Select picked before Save is enabled
// ────────────────────────────────────────────────────────────────────────

test.describe("Form smoke — forms requiring a Select pick", () => {
  test("attribute-definition (needs type pick)", async ({ page }) => {
    await page.goto("/settings/attribute-definitions/new");
    await expectNoUiErrors(page);

    const unique = `e2e_ad_${Date.now()}`;
    await fillById(page, "ad-label", `E2E AD ${Date.now()}`);
    await fillById(page, "ad-key", unique);

    // Default value_type is usually "text" — that's the safe path.
    await clickSave(page, /Create attribute/i);
    await page.waitForURL((u) => !u.toString().endsWith("/new"), {
      timeout: 10_000,
    });
    await expectNoUiErrors(page);
  });

  test("item (needs type + stock UoM pick)", async ({ page }) => {
    await page.goto("/settings/items/new");
    await expectNoUiErrors(page);

    await fillById(page, "i-name", `E2E item ${Date.now()}`);

    // Item type picker — first combobox in the form (raw material default).
    const itemTypeCombo = page.getByRole("combobox").first();
    await itemTypeCombo.click();
    await page.getByRole("option", { name: /Raw material/i }).first().click();
    await expect(page.getByRole("option")).toHaveCount(0);

    // Stock UoM picker — next combobox after type.
    const stockUomCombo = page.getByRole("combobox").nth(1);
    await stockUomCombo.scrollIntoViewIfNeeded();
    await stockUomCombo.click();
    const firstUom = page.getByRole("option").first();
    await expect(firstUom).toBeVisible();
    await firstUom.click();
    await expect(page.getByRole("option")).toHaveCount(0);

    await clickSave(page, /Create item/i);
    await page.waitForURL((u) => !u.toString().endsWith("/new"), {
      timeout: 10_000,
    });
    await expectNoUiErrors(page);
  });
});
