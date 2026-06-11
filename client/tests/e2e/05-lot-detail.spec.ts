import { test, expect } from "@playwright/test";
import fs from "node:fs";

test.use({ storageState: ".auth/laptop.json" });

test.describe("Lot detail page (slice D.1.2)", () => {
  test("loads with header + identity + packaging cards", async ({
    page,
    playwright,
  }) => {
    // Grab the first lot's uuid directly from the backend so the page
    // test doesn't depend on the list-table's row-click navigation.
    const state = JSON.parse(fs.readFileSync(".auth/laptop.json", "utf-8")) as {
      cookies: Array<{ name: string; value: string }>;
    };
    const bearer =
      state.cookies.find((c) => c.name === "psp_session")?.value ?? "";

    const api = await playwright.request.newContext({
      baseURL: process.env.E2E_BACKEND_URL || "http://localhost:4000",
      extraHTTPHeaders: { Authorization: `Bearer ${bearer}` },
    });
    const res = await api.get("/api/stock/lots?limit=1");
    const json = (await res.json()) as { items: Array<{ uuid: string }> };
    await api.dispose();
    test.skip(json.items.length === 0, "no lots in dev DB");

    await page.goto(`/stock/lots/${json.items[0].uuid}`);
    await expect(page.getByText(/Back to lots/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Print label/i }),
    ).toBeVisible();
    await expect(page.getByText(/On hand/i).first()).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Identity/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Packaging/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Placements/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Movement history/i }),
    ).toBeVisible();
  });

  test("save changes round-trips via PATCH (slice D.1.4)", async ({
    page,
    playwright,
  }) => {
    const state = JSON.parse(fs.readFileSync(".auth/laptop.json", "utf-8")) as {
      cookies: Array<{ name: string; value: string }>;
    };
    const bearer =
      state.cookies.find((c) => c.name === "psp_session")?.value ?? "";
    const api = await playwright.request.newContext({
      baseURL: process.env.E2E_BACKEND_URL || "http://localhost:4000",
      extraHTTPHeaders: { Authorization: `Bearer ${bearer}` },
    });
    const res = await api.get("/api/stock/lots?limit=1");
    const json = (await res.json()) as { items: Array<{ uuid: string }> };
    await api.dispose();
    test.skip(json.items.length === 0, "no lots in dev DB");

    const uuid = json.items[0].uuid;
    await page.goto(`/stock/lots/${uuid}`);

    // Form is read-only by default — press Edit before touching any
    // input.
    await page.getByRole("button", { name: /^Edit$/ }).click();

    // The legacy `notes` textarea was replaced by the polymorphic
    // comments module per psp/CLAUDE.md ("notes → comments"). Edit
    // `supplier_batch_no` instead — still a free-text field on the
    // identity card.
    const note = `e2e-${Date.now()}`;
    const batchInput = page.locator("#supplier_batch_no");
    await batchInput.click();
    await batchInput.press("ControlOrMeta+a");
    await batchInput.press("Delete");
    await batchInput.fill(note);

    await expect(page.getByRole("button", { name: /Save changes/i })).toBeEnabled();
    await page.getByRole("button", { name: /Save changes/i }).click();

    // The save bar disappears once the change has been persisted +
    // router.refresh() re-fetches the page state.
    await expect(
      page.getByRole("button", { name: /Save changes/i }),
    ).toHaveCount(0, { timeout: 10_000 });

    // Round-trip: the new note is now in the DB.
    const verify = await playwright.request.newContext({
      baseURL: process.env.E2E_BACKEND_URL || "http://localhost:4000",
      extraHTTPHeaders: { Authorization: `Bearer ${bearer}` },
    });
    const verifyRes = await verify.get(`/api/stock/lots/${uuid}`);
    const verifyJson = (await verifyRes.json()) as {
      lot: { supplier_batch_no: string | null };
    };
    await verify.dispose();
    expect(verifyJson.lot.supplier_batch_no).toBe(note);
  });

  test("Adjust qty dialog records an adjust_down movement (slice D.1.6)", async ({
    page,
    playwright,
  }) => {
    const state = JSON.parse(fs.readFileSync(".auth/laptop.json", "utf-8")) as {
      cookies: Array<{ name: string; value: string }>;
    };
    const bearer =
      state.cookies.find((c) => c.name === "psp_session")?.value ?? "";
    const api = await playwright.request.newContext({
      baseURL: process.env.E2E_BACKEND_URL || "http://localhost:4000",
      extraHTTPHeaders: { Authorization: `Bearer ${bearer}` },
    });
    const lotsRes = await api.get("/api/stock/lots?limit=1");
    const lotsJson = (await lotsRes.json()) as {
      items: Array<{ uuid: string }>;
    };
    test.skip(lotsJson.items.length === 0, "no lots in dev DB");
    const uuid = lotsJson.items[0].uuid;

    const beforeRes = await api.get(`/api/stock/lots/${uuid}`);
    const beforeJson = (await beforeRes.json()) as {
      lot: { qty_on_hand: string; placements: Array<{ qty: string }> };
      movements: Array<{ kind: string }>;
    };
    const beforeQty = Number(beforeJson.lot.qty_on_hand);
    test.skip(beforeQty <= 1, "lot has too little stock to safely adjust down");

    await page.goto(`/stock/lots/${uuid}`);
    await page.getByRole("button", { name: /Adjust qty/i }).click();

    await page.getByRole("button", { name: /Adjust down/i }).click();
    await page.getByPlaceholder("0.00").fill("1");
    await page.getByPlaceholder(/Stock take/i).fill("e2e shrinkage");

    await page.getByRole("button", { name: /Record adjustment/i }).click();

    // Dialog closes after success.
    await expect(
      page.getByRole("heading", { name: /^Adjust qty$/i }),
    ).toHaveCount(0, { timeout: 10_000 });

    // Verify backend: qty went down by 1 and an adjust_down movement
    // landed on the timeline.
    const verifyRes = await api.get(`/api/stock/lots/${uuid}`);
    const verifyJson = (await verifyRes.json()) as {
      lot: { qty_on_hand: string };
      movements: Array<{ kind: string; delta_qty: string }>;
    };
    await api.dispose();
    expect(Number(verifyJson.lot.qty_on_hand)).toBe(beforeQty - 1);
    expect(verifyJson.movements[0].kind).toBe("adjust_down");
  });

  test("Move dialog opens + cell picker is searchable (slice D.1.5)", async ({
    page,
    playwright,
  }) => {
    const state = JSON.parse(fs.readFileSync(".auth/laptop.json", "utf-8")) as {
      cookies: Array<{ name: string; value: string }>;
    };
    const bearer =
      state.cookies.find((c) => c.name === "psp_session")?.value ?? "";
    const api = await playwright.request.newContext({
      baseURL: process.env.E2E_BACKEND_URL || "http://localhost:4000",
      extraHTTPHeaders: { Authorization: `Bearer ${bearer}` },
    });
    const res = await api.get("/api/stock/lots?limit=1");
    const json = (await res.json()) as { items: Array<{ uuid: string }> };
    await api.dispose();
    test.skip(json.items.length === 0, "no lots in dev DB");

    await page.goto(`/stock/lots/${json.items[0].uuid}`);
    await page.getByRole("button", { name: /^Move$/ }).click();

    // Dialog title should appear; cell picker placeholder waits to
    // see "Search cells…".
    await expect(
      page.getByRole("heading", { name: /Move stock/i }),
    ).toBeVisible();
    await expect(page.getByText(/Search cells…/i)).toBeVisible();
    // Cancel — no submit, no state change to the DB.
    await page.getByRole("button", { name: /Cancel/i }).click();
    await expect(
      page.getByRole("heading", { name: /Move stock/i }),
    ).toHaveCount(0);
  });
});
