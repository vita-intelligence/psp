import { test as setup, expect, request } from "@playwright/test";

/**
 * Logs in the seeded E2E admin user (created via
 * `backend/scripts/ensure_e2e_user.exs`) and persists the resulting
 * session cookie to `.auth/laptop.json`. Downstream specs reuse this
 * storage state — no UI login per spec.
 *
 * The user has `is_admin = true`, so every RBAC gate short-circuits.
 */
const E2E_EMAIL = process.env.E2E_EMAIL || "e2e@vitamanufacture.co.uk";
const E2E_PASSWORD = process.env.E2E_PASSWORD || "e2e-playwright-pass";

setup("laptop session", async ({ playwright, context, page }) => {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL || "https://localhost:3000";
  const backendURL = process.env.E2E_BACKEND_URL || "http://localhost:4000";

  // Login hits Phoenix directly — Next only proxies through a server
  // action, which we'd have to drive via the UI. The token in the
  // response body is the same Phoenix.Token the cookie carries.
  const apiCtx = await playwright.request.newContext({
    baseURL: backendURL,
    ignoreHTTPSErrors: true,
  });
  const res = await apiCtx.post("/api/auth/login", {
    data: { email: E2E_EMAIL, password: E2E_PASSWORD },
  });
  expect(res.status(), `login should succeed; body=${await res.text()}`).toBe(
    200,
  );
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

  await context.storageState({ path: ".auth/laptop.json" });
  await apiCtx.dispose();
});
