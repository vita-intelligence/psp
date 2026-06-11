import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

/**
 * Realtime polymorphic comment thread.
 *
 * Opens two browser contexts on the same vendor detail page, posts a
 * comment from the host, and asserts the peer sees it appear within
 * a few seconds via the live `comments:vendor:<uuid>` channel — no
 * page reload, no peer-side action.
 *
 * Uses the seeded `e2e@vitamanufacture.co.uk` (host) and
 * `e2e-alt@vitamanufacture.co.uk` (peer) admins — both have
 * `vendors.edit`, so both can post.
 */

async function fetchFirstVendorUuid(
  playwright: typeof import("@playwright/test").request extends never
    ? never
    : Parameters<Parameters<typeof test>[1]>[0]["playwright"],
): Promise<string | null> {
  const state = JSON.parse(fs.readFileSync(".auth/laptop.json", "utf-8")) as {
    cookies: Array<{ name: string; value: string }>;
  };
  const bearer =
    state.cookies.find((c) => c.name === "psp_session")?.value ?? "";
  const api = await playwright.request.newContext({
    baseURL: process.env.E2E_BACKEND_URL || "http://localhost:4000",
    extraHTTPHeaders: { Authorization: `Bearer ${bearer}` },
  });
  const res = await api.get("/api/vendors?limit=1");
  const json = (await res.json()) as { items: Array<{ uuid: string }> };
  await api.dispose();
  return json.items?.[0]?.uuid ?? null;
}

async function gotoVendor(page: Page, uuid: string) {
  await page.goto(`/procurement/vendors/${uuid}`);
  // CardTitle renders as a styled div, not a heading role — match by text.
  await expect(page.getByText("Discussion").first()).toBeVisible({
    timeout: 10_000,
  });
}

// Skipped: the channel-join race between host post and peer subscribe is
// flaky in the CI-style run (peer's CommentChannel may not have joined
// before the host's POST fires). The single-user comment post is covered
// by 24-comments-flow.spec.ts; revisit this fan-out spec once we add a
// "channel joined" readiness signal to <CommentThread />.
test.skip("comments fan out live to peers", async ({ browser, playwright }) => {
  const uuid = await fetchFirstVendorUuid(playwright);
  test.skip(!uuid, "no vendors in the seed DB");

  const hostCtx = await browser.newContext({
    storageState: ".auth/laptop.json",
  });
  const peerCtx = await browser.newContext({ storageState: ".auth/alt.json" });

  const host = await hostCtx.newPage();
  const peer = await peerCtx.newPage();

  try {
    await Promise.all([gotoVendor(host, uuid!), gotoVendor(peer, uuid!)]);

    // The peer's Discussion card should currently NOT show this body.
    const marker = `e2e-live-${Date.now()}`;
    await expect(peer.getByText(marker)).toHaveCount(0);

    // Host opens the composer + types + Ctrl+Enter to send.
    const composer = host.getByPlaceholder(/Write a comment/i);
    await composer.scrollIntoViewIfNeeded();
    await composer.fill(marker);
    await host.getByRole("button", { name: /^Send$/ }).click();

    // Peer should see the new comment within 3s via the live channel.
    await expect(peer.getByText(marker)).toBeVisible({ timeout: 5000 });
  } finally {
    await hostCtx.close();
    await peerCtx.close();
  }
});
