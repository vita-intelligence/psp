import { expect, type Browser, type Page } from "@playwright/test";

/**
 * Two-browser collaboration assertion helper.
 *
 * Opens the same form URL in two different browser contexts — one
 * authenticated as the seeded "host" user (laptop session), one as the
 * "peer" user (alt session) — and asserts the realtime-collab contract
 * codified in `psp/CLAUDE.md`:
 *
 *   1. Both users appear in each other's CollabAvatars header.
 *   2. Peer (non-creator) sees the "Only {host} can save…" lock banner.
 *   3. Peer's Save/Create button is disabled.
 *   4. Host focusing the primary field shows a FieldEditingIndicator on
 *      the peer's side near that field.
 *   5. Host typing into a text field replicates to the peer's view.
 *
 * If a form's first input isn't a plain text input (e.g. a Select), set
 * `skipTextReplication`. If the form gates Save on a different button
 * label, set `saveButtonName`.
 */

const HOST_NAME = "E2E Playwright";
const PEER_NAME = "E2E Peer";

export interface CollabFormCheck {
  /** URL to navigate to (with leading slash). */
  url: string;
  /** Visible heading that confirms the form rendered (substring or regex). */
  readyHeading: string | RegExp;
  /** id attribute of the primary text input. Default: "name". Set to
   *  null to skip focus/typing assertions entirely (e.g. forms with
   *  only Selects). */
  primaryFieldId?: string | null;
  /** Skip the "host types, peer sees value replicate" check. Use when
   *  the field is a Select/Checkbox/etc — focus check still runs. */
  skipTextReplication?: boolean;
  /** Save/Create button name. Default: /Save|Create/. */
  saveButtonName?: string | RegExp;
  /** Optional setup step run on BOTH pages once they've loaded — e.g.
   *  clicking an "Edit" toggle to enter edit mode on forms that gate
   *  inputs behind it. Runs before the collab assertions. */
  prepareForm?: (page: Page) => Promise<void>;
}

export async function assertCollab(
  browser: Browser,
  check: CollabFormCheck,
): Promise<void> {
  const {
    url,
    readyHeading,
    primaryFieldId = "name",
    skipTextReplication = false,
    saveButtonName = /Save|Create/i,
    prepareForm,
  } = check;

  // -- Host opens first → becomes room creator
  const hostCtx = await browser.newContext({
    storageState: ".auth/laptop.json",
    ignoreHTTPSErrors: true,
  });
  const host = await hostCtx.newPage();
  await host.goto(url);
  // "Ready" signal: prefer the primary input — it's specific to the
  // form's body and won't false-match nav links. Fall back to a
  // heading match for forms without an id'd primary input.
  await expect(
    primaryFieldId !== null
      ? host.locator(`#${primaryFieldId}`)
      : host
          .getByRole("heading", { name: readyHeading })
          .or(host.getByText(readyHeading))
          .first(),
  ).toBeVisible({ timeout: 10_000 });

  if (prepareForm) await prepareForm(host);

  // Small wait so the host's `Presence.track` lands before the peer's
  // join. The "creator" is computed as the earliest `joined_at` across
  // the room — we need the host to be first.
  await host.waitForTimeout(500);

  // -- Peer opens second
  const peerCtx = await browser.newContext({
    storageState: ".auth/alt.json",
    ignoreHTTPSErrors: true,
  });
  const peer = await peerCtx.newPage();
  await peer.goto(url);
  await expect(
    primaryFieldId !== null
      ? peer.locator(`#${primaryFieldId}`)
      : peer
          .getByRole("heading", { name: readyHeading })
          .or(peer.getByText(readyHeading))
          .first(),
  ).toBeVisible({ timeout: 10_000 });

  if (prepareForm) await prepareForm(peer);

  try {
    // 1. Both see each other in the CollabAvatars header. The avatars
    //    carry a `title` of either the peer's name or "{name} — editing
    //    {field}". A substring match on the name catches both shapes.
    await expect(
      host.locator(`[title*="${PEER_NAME}"]`).first(),
      `host should see peer "${PEER_NAME}" in CollabAvatars on ${url}`,
    ).toBeVisible({ timeout: 7_000 });
    await expect(
      peer.locator(`[title*="${HOST_NAME}"]`).first(),
      `peer should see host "${HOST_NAME}" in CollabAvatars on ${url}`,
    ).toBeVisible({ timeout: 7_000 });

    // 2. Peer sees the creator-gate lock banner naming the host.
    //    `.first()` because shared-channel pages (e.g. /settings/company
    //    with 7 sub-forms on one `company:1` topic) render the banner
    //    once per sub-form.
    await expect(
      peer
        .getByText(new RegExp(`Only\\s+${HOST_NAME.replace(/ /g, "\\s+")}`))
        .first(),
      `peer should see "Only ${HOST_NAME} can save…" banner on ${url}`,
    ).toBeVisible({ timeout: 7_000 });

    // 3. Peer's primary action button is disabled (creator gate).
    const peerSaveBtn = peer.getByRole("button", { name: saveButtonName });
    await expect(
      peerSaveBtn.first(),
      `peer's save/create button should be disabled on ${url}`,
    ).toBeDisabled();

    if (primaryFieldId !== null) {
      // 4. Host focuses the primary field → peer sees the editing
      //    indicator anchored near that field.
      await host.locator(`#${primaryFieldId}`).focus();
      await expect(
        peer.locator(`[title="${HOST_NAME} is editing"]`),
        `peer should see "${HOST_NAME} is editing" indicator after host focuses #${primaryFieldId} on ${url}`,
      ).toBeVisible({ timeout: 7_000 });

      if (!skipTextReplication) {
        // 5. Host types → peer's input value updates via field:change.
        const sample = `Collab ${Date.now()}`;
        await host.locator(`#${primaryFieldId}`).fill(sample);
        await expect(
          peer.locator(`#${primaryFieldId}`),
          `peer's #${primaryFieldId} should mirror host's input on ${url}`,
        ).toHaveValue(sample, { timeout: 7_000 });
      }
    }
  } finally {
    await hostCtx.close();
    await peerCtx.close();
  }
}
