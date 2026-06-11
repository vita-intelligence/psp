import { test as setup, expect } from "@playwright/test";

/**
 * Logs in the seeded E2E admin users (created via
 * `backend/scripts/ensure_e2e_{,alt_}user.exs`) and persists the
 * resulting session cookies to `.auth/laptop.json` and `.auth/alt.json`.
 *
 * Two users are needed because the realtime-collab matrix specs open
 * two browser contexts simultaneously and assert peers see each other's
 * presence + cursors + field focus. Both users are admins so every RBAC
 * gate short-circuits.
 */
async function login(
  playwright: typeof import("@playwright/test").request extends never
    ? never
    : Parameters<Parameters<typeof setup>[1]>[0]["playwright"],
  context: Parameters<Parameters<typeof setup>[1]>[0]["context"],
  page: Parameters<Parameters<typeof setup>[1]>[0]["page"],
  email: string,
  password: string,
  storageStatePath: string,
) {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL || "https://localhost:3000";
  const backendURL = process.env.E2E_BACKEND_URL || "http://localhost:4000";

  const apiCtx = await playwright.request.newContext({
    baseURL: backendURL,
    ignoreHTTPSErrors: true,
  });
  const res = await apiCtx.post("/api/auth/login", {
    data: { email, password },
  });
  expect(
    res.status(),
    `login for ${email} should succeed; body=${await res.text()}`,
  ).toBe(200);
  const body = (await res.json()) as { token?: string };
  const token = body.token;
  expect(token, "backend should return a session token").toBeTruthy();

  const url = new URL(baseURL);
  await context.addCookies([
    {
      name: "psp_session",
      value: token!,
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: url.protocol === "https:",
    },
  ]);

  await page.goto("/settings/profile");
  await expect(page).not.toHaveURL(/\/login/);

  await context.storageState({ path: storageStatePath });
  await apiCtx.dispose();
}

setup("laptop session", async ({ playwright, context, page }) => {
  await login(
    playwright,
    context,
    page,
    process.env.E2E_EMAIL || "e2e@vitamanufacture.co.uk",
    process.env.E2E_PASSWORD || "e2e-playwright-pass",
    ".auth/laptop.json",
  );
});

setup("alt session", async ({ playwright, context, page }) => {
  await login(
    playwright,
    context,
    page,
    process.env.E2E_ALT_EMAIL || "e2e-alt@vitamanufacture.co.uk",
    process.env.E2E_ALT_PASSWORD || "e2e-playwright-pass-alt",
    ".auth/alt.json",
  );
});
