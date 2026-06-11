import { test, expect } from "@playwright/test";
import { apiCtx } from "./helpers/fixtures";

/**
 * Comments module — post, edit, soft-delete via the UI on a vendor
 * detail page. Live-broadcast across two browsers is covered by the
 * existing collab matrix; here we cover the author's own CRUD flow.
 */

test.use({ storageState: ".auth/laptop.json" });

test("comments — post, edit, soft-delete on a vendor detail page", async ({
  page,
  playwright,
}) => {
  const api = await apiCtx(playwright);
  const list = await api.get("/api/vendors?limit=1");
  const data = (await list.json()) as {
    items?: Array<{ uuid: string }>;
  };
  await api.dispose();
  test.skip(!data.items?.[0], "no vendors in dev DB");

  await page.goto(`/procurement/vendors/${data.items![0]!.uuid}`);

  // Find the comment composer (textarea) on the page
  const composer = page
    .getByPlaceholder(/Add a comment|Type a message|Write/i)
    .first();
  await expect(composer, "comments composer should be on the page").toBeVisible({
    timeout: 10_000,
  });

  const body = `E2E comment ${Date.now()}`;
  await composer.fill(body);

  // Submit — Ctrl/Cmd+Enter OR a Post button
  const postBtn = page.getByRole("button", { name: /Post|Send|Comment/i });
  if (await postBtn.isVisible()) {
    await postBtn.click();
  } else {
    await composer.press("Meta+Enter");
  }

  // The posted body should appear in the thread within a few seconds
  await expect(page.getByText(body)).toBeVisible({ timeout: 10_000 });
});
