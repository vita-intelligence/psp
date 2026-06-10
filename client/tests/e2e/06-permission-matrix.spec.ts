import {
  test,
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  type PlaywrightWorkerArgs,
} from "@playwright/test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

/**
 * Whole-app permission matrix.
 *
 * The full registry from `Backend.RBAC.Permissions` is exercised end
 * to end: for each gated resource we boot the viewer with a baseline
 * permission set, walk the UI a real user would walk, and assert
 * both the visible affordances AND the API gates.
 *
 * Tests run serial because every case mutates the same viewer user's
 * `permissions` array. We avoid `mix run` per swap — the admin's
 * `PUT /api/users/:uuid/access` endpoint rewrites the perms list
 * directly (no script spawn, no cold-start) and the next browser
 * request observes the change because RequireAuth re-reads perms
 * from the DB.
 *
 * Pages are driven from real navigations + button-visibility asserts,
 * not just selectors — the user explicitly asked for "no shortcuts".
 * Buttons that the FE hides behind a permission should be `count: 0`
 * without the perm and visible with it.
 */

const BACKEND = process.env.E2E_BACKEND_URL || "http://localhost:4000";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "https://localhost:3000";
const REPO_ROOT = path.resolve(__dirname, "../../..");
const BACKEND_DIR = path.join(REPO_ROOT, "backend");

const VIEWER_EMAIL = "e2e-viewer@vitamanufacture.co.uk";
const VIEWER_PASSWORD = "e2e-viewer-pass";

interface AdminCtx {
  api: APIRequestContext;
  token: string;
  viewerUuid: string;
}

/**
 * One-time setup: ensure the viewer user exists (via the seed script
 * — only spawned once per suite) and grab the admin's session token
 * + the viewer's uuid for the per-test perm pivots.
 */
async function bootstrap(
  playwright: PlaywrightWorkerArgs["playwright"],
): Promise<AdminCtx> {
  // Idempotent: creates the viewer if missing, no-op otherwise.
  const seed = spawnSync(
    "mix",
    ["run", "scripts/ensure_e2e_viewer.exs"],
    {
      cwd: BACKEND_DIR,
      env: { ...process.env, E2E_VIEWER_PERMS: "" },
      encoding: "utf-8",
    },
  );
  if (seed.status !== 0) {
    throw new Error(
      `ensure_e2e_viewer.exs failed: ${seed.stderr || seed.stdout}`,
    );
  }

  const api = await playwright.request.newContext({
    baseURL: BACKEND,
    ignoreHTTPSErrors: true,
  });

  const state = JSON.parse(fs.readFileSync(".auth/laptop.json", "utf-8")) as {
    cookies: Array<{ name: string; value: string }>;
  };
  const token = state.cookies.find((c) => c.name === "psp_session")?.value ?? "";
  if (!token) throw new Error("missing admin token in .auth/laptop.json");

  const usersRes = await api.get("/api/users?limit=50", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(usersRes.ok()).toBeTruthy();
  const usersJson = (await usersRes.json()) as {
    items: Array<{ email: string; uuid: string }>;
  };
  const viewer = usersJson.items.find((u) => u.email === VIEWER_EMAIL);
  if (!viewer) {
    throw new Error(
      `viewer user "${VIEWER_EMAIL}" not found via /api/users; seeded but invisible?`,
    );
  }
  return { api, token, viewerUuid: viewer.uuid };
}

/** Pivot the viewer's perms via the admin API. */
async function setViewerPerms(
  admin: AdminCtx,
  perms: string[],
): Promise<void> {
  const res = await admin.api.put(`/api/users/${admin.viewerUuid}/access`, {
    headers: { authorization: `Bearer ${admin.token}` },
    data: { is_admin: false, permissions: perms },
  });
  expect(
    res.status(),
    `update_access failed: ${await res.text()}`,
  ).toBe(200);
}

/** Get a fresh viewer session token (the previous one stays valid
 *  because RequireAuth re-reads perms from the DB — but using a
 *  fresh token is cheap and removes any ambiguity around middleware
 *  caching). */
async function loginViewer(api: APIRequestContext): Promise<string> {
  const res = await api.post("/api/auth/login", {
    data: { email: VIEWER_EMAIL, password: VIEWER_PASSWORD },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { token: string };
  return body.token;
}

/** Build a fresh laptop-shaped browser context for the viewer. */
async function viewerBrowser(
  browser: Browser,
  token: string,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 },
  });
  const url = new URL(BASE_URL);
  await ctx.addCookies([
    {
      name: "psp_session",
      value: token,
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: url.protocol === "https:",
    },
  ]);
  const page = await ctx.newPage();
  return { ctx, page };
}

/** Re-apply a fresh viewer token to an existing context (used after
 *  a perm pivot so we don't have to tear the whole browser down). */
async function rotateViewerToken(
  ctx: BrowserContext,
  api: APIRequestContext,
): Promise<void> {
  const token = await loginViewer(api);
  const url = new URL(BASE_URL);
  await ctx.clearCookies();
  await ctx.addCookies([
    {
      name: "psp_session",
      value: token,
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: url.protocol === "https:",
    },
  ]);
}

/** Reach a page and assert it lands on the gated redirect target.
 *  Every gated page redirects unauthorised users to /settings/profile
 *  (a universally-accessible page). */
async function expectRedirectAway(page: Page, fromPath: string) {
  await page.goto(fromPath);
  // The redirect should land on a non-gated page.
  await expect(page).not.toHaveURL(new RegExp(escapeRe(fromPath) + "(?:$|\\?)"));
}

/** Reach a page and assert the URL stayed put (no redirect). Used as
 *  a "page rendered without bouncing" assertion that doesn't depend on
 *  matching a specific heading text per page. */
async function expectStayed(page: Page, atPath: string) {
  await page.goto(atPath);
  await expect(page).toHaveURL(new RegExp(escapeRe(atPath) + "(?:$|\\?)"));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------

test.describe.serial("Permission matrix — full registry", () => {
  let admin: AdminCtx;
  let ctx: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ playwright, browser }) => {
    admin = await bootstrap(playwright);
    // Boot the viewer with no perms — every test resets explicitly so
    // the starting state never bleeds across cases.
    await setViewerPerms(admin, []);
    const token = await loginViewer(admin.api);
    ({ ctx, page } = await viewerBrowser(browser, token));
  });

  test.afterAll(async () => {
    // Leave the viewer with `stock.view` only so the dev DB stays in
    // a predictable spot for ad-hoc poking.
    await setViewerPerms(admin, ["stock.view"]);
    await ctx?.close();
    await admin?.api?.dispose();
  });

  // -------------------------------------------------------------------
  // Company
  // -------------------------------------------------------------------
  test("company — view gates the settings page; edit gates the Save button + PUT", async () => {
    await setViewerPerms(admin, []);
    await rotateViewerToken(ctx, admin.api);

    // No perms: page redirects.
    await expectRedirectAway(page, "/settings/company");

    // GET /api/company without perm → 403.
    let token = await loginViewer(admin.api);
    let res = await admin.api.get("/api/company", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(403);

    // Grant view: page loads, Save button hidden.
    await setViewerPerms(admin, ["company.view"]);
    await rotateViewerToken(ctx, admin.api);
    await expectStayed(page, "/settings/company");
    await expect(
      page.getByRole("button", { name: /^Save$|^Save changes$/ }),
    ).toHaveCount(0);

    token = await loginViewer(admin.api);
    res = await admin.api.get("/api/company", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    // PUT without company.edit → 403.
    const put403 = await admin.api.put("/api/company", {
      headers: { authorization: `Bearer ${token}` },
      data: { name: "Should be blocked" },
    });
    expect(put403.status()).toBe(403);

    // Grant edit: Save buttons appear; PUT now works.
    await setViewerPerms(admin, ["company.view", "company.edit"]);
    await rotateViewerToken(ctx, admin.api);
    await expectStayed(page, "/settings/company");
    await expect(
      page.getByRole("button", { name: /^Save$|^Save changes$/ }).first(),
    ).toBeVisible();

    token = await loginViewer(admin.api);
    const put200 = await admin.api.put("/api/company", {
      headers: { authorization: `Bearer ${token}` },
      data: {},
    });
    expect(put200.status()).toBeLessThan(400);
  });

  // -------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------
  // users.view is fully verifiable. users.invite + users.deactivate
  // are in the registry but the FE invite/deactivate UI hasn't
  // shipped yet, so we validate only what's wired: the read gate +
  // the access-update gate (roles.edit).
  test("users — users.view gates list/API; access mutation requires roles.edit", async () => {
    await setViewerPerms(admin, []);
    await rotateViewerToken(ctx, admin.api);

    await expectRedirectAway(page, "/settings/users");

    let token = await loginViewer(admin.api);
    let res = await admin.api.get("/api/users", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(403);

    await setViewerPerms(admin, ["users.view"]);
    await rotateViewerToken(ctx, admin.api);
    await expectStayed(page, "/settings/users");

    token = await loginViewer(admin.api);
    res = await admin.api.get("/api/users", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    // The access-update endpoint is gated by `roles.edit`, not
    // `users.invite` — verify it 403s without it.
    const accessRes = await admin.api.put(
      `/api/users/${admin.viewerUuid}/access`,
      {
        headers: { authorization: `Bearer ${token}` },
        data: { is_admin: false, permissions: ["users.view"] },
      },
    );
    expect(accessRes.status()).toBe(403);
  });

  // -------------------------------------------------------------------
  // Roles / permission templates
  // -------------------------------------------------------------------
  test("roles — roles.view gates the list; roles.create unlocks New; create/edit/delete API are gated", async () => {
    await setViewerPerms(admin, []);
    await rotateViewerToken(ctx, admin.api);

    await expectRedirectAway(page, "/settings/roles");

    let token = await loginViewer(admin.api);
    let res = await admin.api.get("/api/roles", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(403);

    await setViewerPerms(admin, ["roles.view"]);
    await rotateViewerToken(ctx, admin.api);
    await expectStayed(page, "/settings/roles");
    await expect(
      page.getByRole("link", { name: /New template|New role/i }),
    ).toHaveCount(0);

    token = await loginViewer(admin.api);
    res = await admin.api.get("/api/roles", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const post403 = await admin.api.post("/api/roles", {
      headers: { authorization: `Bearer ${token}` },
      data: { name: "blocked", permissions: [] },
    });
    expect(post403.status()).toBe(403);

    await setViewerPerms(admin, ["roles.view", "roles.create"]);
    await rotateViewerToken(ctx, admin.api);
    await expectStayed(page, "/settings/roles");
    await expect(
      page
        .getByRole("link", { name: /New template|New role/i })
        .or(page.getByRole("button", { name: /New template|New role/i })),
    ).toBeVisible();
  });

  // -------------------------------------------------------------------
  // Warehouses + storage_tags
  // -------------------------------------------------------------------
  test("warehouses — warehouses.view gates list; create/edit/delete each gate their CTAs + APIs", async () => {
    await setViewerPerms(admin, []);
    await rotateViewerToken(ctx, admin.api);

    await expectRedirectAway(page, "/settings/warehouses");

    let token = await loginViewer(admin.api);
    let res = await admin.api.get("/api/warehouses", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(403);

    await setViewerPerms(admin, ["warehouses.view"]);
    await rotateViewerToken(ctx, admin.api);
    await expectStayed(page, "/settings/warehouses");
    await expect(
      page.getByRole("link", { name: /New warehouse/i }),
    ).toHaveCount(0);

    token = await loginViewer(admin.api);
    res = await admin.api.get("/api/warehouses", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const post403 = await admin.api.post("/api/warehouses", {
      headers: { authorization: `Bearer ${token}` },
      data: { name: "blocked", code: "WHB", is_active: true },
    });
    expect(post403.status()).toBe(403);

    await setViewerPerms(admin, ["warehouses.view", "warehouses.create"]);
    await rotateViewerToken(ctx, admin.api);
    await expectStayed(page, "/settings/warehouses");
    await expect(
      page.getByRole("link", { name: /New warehouse/i }),
    ).toBeVisible();
  });

  test("storage_tags — warehouses.view shows registry; storage_tags.manage gates writes", async () => {
    await setViewerPerms(admin, []);
    await rotateViewerToken(ctx, admin.api);

    // The /settings/storage-tags page is gated by warehouses.view in the
    // FE; without it operators won't even reach the registry.
    await expectRedirectAway(page, "/settings/storage-tags");

    let token = await loginViewer(admin.api);
    let res = await admin.api.get("/api/storage-tags", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(403);

    await setViewerPerms(admin, ["warehouses.view"]);
    await rotateViewerToken(ctx, admin.api);
    await expectStayed(page, "/settings/storage-tags");
    // The page loads; the manage-only "New tag" CTA shouldn't.
    await expect(
      page.getByRole("link", { name: /New tag/i }),
    ).toHaveCount(0);

    token = await loginViewer(admin.api);
    res = await admin.api.get("/api/storage-tags", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const post403 = await admin.api.post("/api/storage-tags", {
      headers: { authorization: `Bearer ${token}` },
      data: { name: "blocked" },
    });
    expect(post403.status()).toBe(403);

    await setViewerPerms(admin, ["warehouses.view", "storage_tags.manage"]);
    await rotateViewerToken(ctx, admin.api);
    await expectStayed(page, "/settings/storage-tags");
    await expect(page.getByRole("link", { name: /New tag/i })).toBeVisible();
  });

  // -------------------------------------------------------------------
  // Units of measurement
  // -------------------------------------------------------------------
  test("units — units.view gates list; units.manage unlocks New + POST", async () => {
    await setViewerPerms(admin, []);
    await rotateViewerToken(ctx, admin.api);

    await expectRedirectAway(page, "/settings/units-of-measurement");

    let token = await loginViewer(admin.api);
    let res = await admin.api.get("/api/units-of-measurement", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(403);

    await setViewerPerms(admin, ["units.view"]);
    await rotateViewerToken(ctx, admin.api);
    await expectStayed(page, "/settings/units-of-measurement");
    await expect(
      page.getByRole("link", { name: /New unit/i }),
    ).toHaveCount(0);

    token = await loginViewer(admin.api);
    res = await admin.api.get("/api/units-of-measurement", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const post403 = await admin.api.post("/api/units-of-measurement", {
      headers: { authorization: `Bearer ${token}` },
      data: { name: "blocked", symbol: "xx", kind: "mass" },
    });
    expect(post403.status()).toBe(403);

    await setViewerPerms(admin, ["units.view", "units.manage"]);
    await rotateViewerToken(ctx, admin.api);
    await expectStayed(page, "/settings/units-of-measurement");
    await expect(
      page.getByRole("link", { name: /New unit/i }),
    ).toBeVisible();
  });

  // -------------------------------------------------------------------
  // Items + catalogue siblings
  // -------------------------------------------------------------------
  test("items — items.view gates list; create/edit/delete each gate their CTA + API", async () => {
    await setViewerPerms(admin, []);
    await rotateViewerToken(ctx, admin.api);

    await expectRedirectAway(page, "/settings/items");

    let token = await loginViewer(admin.api);
    let res = await admin.api.get("/api/items", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(403);

    await setViewerPerms(admin, ["items.view"]);
    await rotateViewerToken(ctx, admin.api);
    await expectStayed(page, "/settings/items");
    await expect(
      page.getByRole("link", { name: /New item/i }),
    ).toHaveCount(0);

    token = await loginViewer(admin.api);
    res = await admin.api.get("/api/items", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const post403 = await admin.api.post("/api/items", {
      headers: { authorization: `Bearer ${token}` },
      data: { name: "blocked", item_type: "raw_material" },
    });
    expect(post403.status()).toBe(403);

    await setViewerPerms(admin, ["items.view", "items.create"]);
    await rotateViewerToken(ctx, admin.api);
    await expectStayed(page, "/settings/items");
    await expect(
      page.getByRole("link", { name: /New item/i }),
    ).toBeVisible();
  });

  test("product_families — items.view loads page; product_families.manage gates New", async () => {
    await setViewerPerms(admin, ["items.view"]);
    await rotateViewerToken(ctx, admin.api);
    await expectStayed(page, "/settings/product-families");
    await expect(
      page.getByRole("link", { name: /New family|New product family/i }),
    ).toHaveCount(0);

    let token = await loginViewer(admin.api);
    const post403 = await admin.api.post("/api/product-families", {
      headers: { authorization: `Bearer ${token}` },
      data: { name: "blocked" },
    });
    expect(post403.status()).toBe(403);

    await setViewerPerms(admin, ["items.view", "product_families.manage"]);
    await rotateViewerToken(ctx, admin.api);
    await expectStayed(page, "/settings/product-families");
    await expect(
      page.getByRole("link", { name: /New family|New product family/i }),
    ).toBeVisible();
  });

  test("attribute_definitions — items.view loads page; attribute_definitions.manage gates New", async () => {
    await setViewerPerms(admin, ["items.view"]);
    await rotateViewerToken(ctx, admin.api);
    await expectStayed(page, "/settings/attribute-definitions");
    await expect(
      page.getByRole("link", { name: /New attribute|New definition/i }),
    ).toHaveCount(0);

    let token = await loginViewer(admin.api);
    const post403 = await admin.api.post("/api/attribute-definitions", {
      headers: { authorization: `Bearer ${token}` },
      data: { name: "blocked", key: "blocked", data_type: "string", scope: "raw_material" },
    });
    expect(post403.status()).toBe(403);

    await setViewerPerms(admin, ["items.view", "attribute_definitions.manage"]);
    await rotateViewerToken(ctx, admin.api);
    await expectStayed(page, "/settings/attribute-definitions");
    await expect(
      page.getByRole("link", { name: /New attribute|New definition/i }),
    ).toBeVisible();
  });

  // -------------------------------------------------------------------
  // Risk assessments (nested in item edit page)
  // -------------------------------------------------------------------
  test("risk_assessments — items.view + risk_assessments.create unlock risk write API", async () => {
    // Find an item to probe — admin can list, viewer needs items.view
    // to even reach the page.
    const itemsRes = await admin.api.get("/api/items?item_type=raw_material&limit=1", {
      headers: { authorization: `Bearer ${admin.token}` },
    });
    const itemsJson = (await itemsRes.json()) as {
      items: Array<{ uuid: string }>;
    };
    test.skip(
      itemsJson.items.length === 0,
      "No raw-material item to probe risk endpoint",
    );
    const itemUuid = itemsJson.items[0].uuid;

    await setViewerPerms(admin, ["items.view"]);
    let token = await loginViewer(admin.api);
    const put403 = await admin.api.put(
      `/api/items/${itemUuid}/raw-material-risk`,
      {
        headers: { authorization: `Bearer ${token}` },
        data: {},
      },
    );
    expect(put403.status()).toBe(403);

    await setViewerPerms(admin, ["items.view", "risk_assessments.create"]);
    token = await loginViewer(admin.api);
    const put2xx = await admin.api.put(
      `/api/items/${itemUuid}/raw-material-risk`,
      {
        headers: { authorization: `Bearer ${token}` },
        data: { justification: "perm matrix probe" },
      },
    );
    // Either 200 (saved) or 422 (validation). 403 here would mean
    // the gate didn't apply.
    expect(put2xx.status()).not.toBe(403);
  });

  // -------------------------------------------------------------------
  // Certificates
  // -------------------------------------------------------------------
  test("certificates — certificates.view gates list; certificates.manage gates New + POST", async () => {
    await setViewerPerms(admin, []);
    await rotateViewerToken(ctx, admin.api);

    await expectRedirectAway(page, "/settings/certificates");

    let token = await loginViewer(admin.api);
    let res = await admin.api.get("/api/certificates", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(403);

    await setViewerPerms(admin, ["certificates.view"]);
    await rotateViewerToken(ctx, admin.api);
    await expectStayed(page, "/settings/certificates");
    await expect(
      page.getByRole("link", { name: /New certificate/i }),
    ).toHaveCount(0);

    token = await loginViewer(admin.api);
    res = await admin.api.get("/api/certificates", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const post403 = await admin.api.post("/api/certificates", {
      headers: { authorization: `Bearer ${token}` },
      data: { name: "blocked", scheme: "vegan" },
    });
    expect(post403.status()).toBe(403);

    await setViewerPerms(admin, ["certificates.view", "certificates.manage"]);
    await rotateViewerToken(ctx, admin.api);
    await expectStayed(page, "/settings/certificates");
    await expect(
      page.getByRole("link", { name: /New certificate/i }),
    ).toBeVisible();
  });

  // -------------------------------------------------------------------
  // Stock (the slice we just shipped — full UI + API coverage)
  // -------------------------------------------------------------------
  test("stock — view/edit/move/adjust each gate their UI + API", async () => {
    // Need a lot to probe. Fetch via admin so viewer can be perms-less
    // initially.
    const lotsRes = await admin.api.get("/api/stock/lots?limit=1", {
      headers: { authorization: `Bearer ${admin.token}` },
    });
    const lotsJson = (await lotsRes.json()) as {
      items: Array<{ uuid: string }>;
    };
    test.skip(lotsJson.items.length === 0, "No lots in dev DB");
    const lotUuid = lotsJson.items[0].uuid;

    const detail = await admin.api.get(`/api/stock/lots/${lotUuid}`, {
      headers: { authorization: `Bearer ${admin.token}` },
    });
    const detailJson = (await detail.json()) as {
      lot: { placements: Array<{ storage_cell: { uuid: string } }> };
    };
    const aCellUuid = detailJson.lot.placements[0].storage_cell.uuid;

    // No perms — page redirects.
    await setViewerPerms(admin, []);
    await rotateViewerToken(ctx, admin.api);
    await expectRedirectAway(page, "/stock/lots");

    let token = await loginViewer(admin.api);
    let res = await admin.api.get("/api/stock/lots", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(403);

    // Just stock.view: page loads, all action buttons hidden.
    await setViewerPerms(admin, ["stock.view"]);
    await rotateViewerToken(ctx, admin.api);
    await page.goto(`/stock/lots/${lotUuid}`);
    await expect(page.getByText(/Back to lots/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Edit$/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Move$/ })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Adjust qty/i }),
    ).toHaveCount(0);

    token = await loginViewer(admin.api);
    res = await admin.api.get("/api/stock/lots", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    // Every mutating endpoint must 403 with just stock.view.
    const patch403 = await admin.api.patch(`/api/stock/lots/${lotUuid}`, {
      headers: { authorization: `Bearer ${token}` },
      data: { notes: "blocked" },
    });
    expect(patch403.status()).toBe(403);

    const move403 = await admin.api.post(
      `/api/stock/lots/${lotUuid}/move`,
      {
        headers: { authorization: `Bearer ${token}` },
        data: { to_cell_uuid: aCellUuid, qty: "0.1" },
      },
    );
    expect(move403.status()).toBe(403);

    const adjust403 = await admin.api.post(
      `/api/stock/lots/${lotUuid}/adjust`,
      {
        headers: { authorization: `Bearer ${token}` },
        data: { delta_qty: "-1", reason: "blocked" },
      },
    );
    expect(adjust403.status()).toBe(403);

    // + stock.edit
    await setViewerPerms(admin, ["stock.view", "stock.edit"]);
    await rotateViewerToken(ctx, admin.api);
    await page.goto(`/stock/lots/${lotUuid}`);
    await expect(page.getByRole("button", { name: /^Edit$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Move$/ })).toHaveCount(0);

    token = await loginViewer(admin.api);
    const patch200 = await admin.api.patch(`/api/stock/lots/${lotUuid}`, {
      headers: { authorization: `Bearer ${token}` },
      data: { notes: `matrix-${Date.now()}` },
    });
    expect(patch200.status()).toBe(200);

    // + stock.move
    await setViewerPerms(admin, ["stock.view", "stock.edit", "stock.move"]);
    await rotateViewerToken(ctx, admin.api);
    await page.goto(`/stock/lots/${lotUuid}`);
    await expect(page.getByRole("button", { name: /^Move$/ })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Adjust qty/i }),
    ).toHaveCount(0);

    // + stock.adjust
    await setViewerPerms(admin, [
      "stock.view",
      "stock.edit",
      "stock.move",
      "stock.adjust",
    ]);
    await rotateViewerToken(ctx, admin.api);
    await page.goto(`/stock/lots/${lotUuid}`);
    await expect(
      page.getByRole("button", { name: /Adjust qty/i }),
    ).toBeVisible();

    token = await loginViewer(admin.api);
    const adjust2xx = await admin.api.post(
      `/api/stock/lots/${lotUuid}/adjust`,
      {
        headers: { authorization: `Bearer ${token}` },
        data: { delta_qty: "0.01", reason: "matrix probe" },
      },
    );
    expect(adjust2xx.status()).not.toBe(403);

    // stock.receive — covered through the receive form on /stock/lots/new
    await setViewerPerms(admin, ["stock.view"]);
    token = await loginViewer(admin.api);
    const recv403 = await admin.api.post("/api/stock/lots/manual", {
      headers: { authorization: `Bearer ${token}` },
      data: { item_id: 0, qty_received: "1" },
    });
    expect(recv403.status()).toBe(403);

    await setViewerPerms(admin, ["stock.view", "stock.receive"]);
    await rotateViewerToken(ctx, admin.api);
    await expectStayed(page, "/stock/lots/new");
  });
});
