import { test, expect, devices, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Two-context pair flow. Laptop generates a pairing code on
 * /settings/devices; phone navigates to /pair?code=<code> and claims
 * it, landing on /m with the device cookie set.
 *
 * The phone context's storage state is dumped to .auth/phone.json so
 * the put-away spec can reuse it instead of pairing from scratch.
 */
test.describe("Device pair end-to-end", () => {
  test("laptop creates code → phone claims → phone lands on /m", async ({
    browser,
  }) => {
    const baseURL = process.env.PLAYWRIGHT_BASE_URL || "https://localhost:3000";

    // --- Laptop ----------------------------------------------------
    const laptop = await browser.newContext({
      storageState: ".auth/laptop.json",
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 800 },
    });
    const laptopPage = await laptop.newPage();
    await laptopPage.goto("/settings/devices");

    await laptopPage.getByRole("button", { name: /Pair new device/i }).click();

    // The dialog's actual pairing code lives in the big tracking-[0.4em]
    // div under the QR. There's an earlier `<span className="font-mono">/pair</span>`
    // in the dialog body, so we target the bigger block to disambiguate.
    const codeEl = laptopPage.locator(".font-mono.text-2xl").first();
    await expect(codeEl).toBeVisible({ timeout: 15_000 });
    const code = (await codeEl.innerText()).trim();
    expect(code).toMatch(/^[A-Z0-9]{4,8}$/);

    // --- Phone -----------------------------------------------------
    const phone = await browser.newContext({
      ...devices["Pixel 7"],
      ignoreHTTPSErrors: true,
    });
    const phonePage = await phone.newPage();
    await phonePage.goto(`/pair?code=${encodeURIComponent(code)}`);

    // Label auto-fills from UA detection. Override to something stable.
    const labelInput = phonePage.getByLabel("Device name");
    await expect(labelInput).toBeVisible();
    await labelInput.fill("E2E Test Phone");
    await phonePage.getByRole("button", { name: /Pair this device/i }).click();

    // Successful claim redirects to /m (mobile shell). Allow a
    // generous timeout because the backend writes a device row +
    // sets a cookie + we ride a client-side redirect.
    await phonePage.waitForURL(/\/m(\/|$|\?)/, { timeout: 15_000 });
    await expect(phonePage).toHaveURL(/\/m/);

    // Dump the phone's authenticated state so downstream specs reuse
    // it without having to re-pair every run.
    const authDir = path.resolve(".auth");
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir);
    await phone.storageState({ path: path.join(authDir, "phone.json") });

    await laptop.close();
    await phone.close();
  });
});
