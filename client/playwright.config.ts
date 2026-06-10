import { defineConfig, devices } from "@playwright/test";

/**
 * One-shot smoke suite for the put-away / pair / fit-check flow we
 * just shipped. Runs against the dev server already on
 * https://localhost:3000 — self-signed cert, so ignoreHTTPSErrors.
 *
 * Two projects:
 *   - `laptop`   — 1280×800 chrome for /settings/devices, /stock/lots/new
 *   - `phone`    — iPhone 13 emulation for /pair and /m flows
 *
 * Session auth is reused from `.auth/laptop.json` (set up once by
 * the `auth.setup.ts` spec, which pulls the cookie value from
 * PSP_SESSION_COOKIE env).
 *
 * Camera/file-upload path is used for QR scanning; we never need
 * a real webcam.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "https://localhost:3000",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "laptop",
      use: {
        ...devices["Desktop Chrome"],
        ignoreHTTPSErrors: true,
        viewport: { width: 1280, height: 800 },
        storageState: ".auth/laptop.json",
      },
      dependencies: ["setup"],
    },
    {
      name: "phone",
      use: {
        ...devices["Pixel 7"],
        ignoreHTTPSErrors: true,
      },
      dependencies: ["setup"],
    },
  ],
});
