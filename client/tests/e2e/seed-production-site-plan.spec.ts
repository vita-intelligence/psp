import { test, expect } from "@playwright/test";

/**
 * One-shot UI-flow seed for a production-site floor plan.
 *
 * Drives the Konva plan editor like an operator: presses keyboard
 * shortcuts to switch tools, drags rectangles on the canvas to draw
 * walls and racks, commits with Save. Same channel + HTTP traffic a
 * real session generates — no backend short-cuts.
 *
 * Layout: 4 perimeter walls, 2 internal dividers, 6 racks across
 * receiving / WIP / QA hold / dispatch on a 1200×800 cm floor.
 *
 * Run:
 *
 *     PROD_FACILITY_UUID=<uuid> \
 *     npx playwright test seed-production-site-plan.spec.ts \
 *       --project=laptop
 *
 * Add `--headed` to watch the canvas fill in live.
 */

// Use maksym's freshly-minted session (see /tmp/mint_maksym_session.exs).
// Running as the actual owner avoids the head-of-room block — maksym IS
// head of the room regardless of who else has the tab open.
test.use({ storageState: ".auth/maksym.json" });

// Editor default — see DEFAULT_VIEWPORT in warehouse-plan-editor.tsx.
// We re-assert it via `Reset view` before drawing so a prior pan/zoom
// doesn't shift our world→pixel math.
const VIEW_SCALE = 0.4;

// World-coordinate walls (cm). Drawn with the Wall tool (W shortcut),
// which is drag-to-create just like Storage Location.
interface WallSpec {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// Layout fits a 1080×1400 cm floor (max canvas at 0.4 scale ≈
// 1100×1500 cm given a 440×600 px stage; we keep a 20 cm margin so
// drags don't slip off the right edge and lose their mouseup event).
const WALLS: WallSpec[] = [
  // Outer perimeter — clockwise from top-left corner.
  { x1: 40, y1: 40, x2: 1040, y2: 40 },
  { x1: 1040, y1: 40, x2: 1040, y2: 1320 },
  { x1: 1040, y1: 1320, x2: 40, y2: 1320 },
  { x1: 40, y1: 1320, x2: 40, y2: 40 },
  // Internal dividers — vertical splits the top half into
  // receiving / WIP; horizontal divides the upper production zone
  // from the lower dispatch + QA zone.
  { x1: 540, y1: 40, x2: 540, y2: 700 },
  { x1: 40, y1: 700, x2: 1040, y2: 700 },
];

interface RackSpec {
  /** Used only for the human reading the spec — names are not set
   *  by this script; the editor assigns auto-generated SL codes. */
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const RACKS: RackSpec[] = [
  // Top-left zone — material receiving from warehouse.
  { label: "Receiving A", x: 100, y: 120, width: 200, height: 120 },
  { label: "Receiving B", x: 320, y: 120, width: 200, height: 120 },
  // Top-right zone — WIP storage stacked.
  { label: "WIP A",       x: 600, y: 120, width: 200, height: 120 },
  { label: "WIP B",       x: 600, y: 280, width: 200, height: 120 },
  { label: "WIP C",       x: 820, y: 120, width: 180, height: 120 },
  // Bottom zone — QA hold + dispatch.
  { label: "QA Hold",     x: 100, y: 800, width: 200, height: 140 },
  { label: "Dispatch",    x: 800, y: 800, width: 200, height: 140 },
];

test("seed production-site plan — walls + racks via canvas drag", async ({
  page,
}) => {
  const uuid = process.env.PROD_FACILITY_UUID;
  expect(
    uuid,
    "PROD_FACILITY_UUID env var must point at the target site",
  ).toBeTruthy();

  await page.goto(`/settings/production-sites/${uuid}?tab=plan`);

  // Wait for the editor shell to mount. The Save button is always
  // rendered (disabled until dirty), so we use it as our readiness
  // anchor.
  await expect(page.getByRole("button", { name: /^save$/i }).last()).toBeVisible({
    timeout: 15_000,
  });

  // Reset view so the world→pixel math below is deterministic.
  await page.getByTitle("Reset view").click();

  // Locate the Konva stage container. The canvas itself sits inside
  // .konvajs-content — bounding box on the wrapping div is stable
  // mid-drag, but toolbar selection can reflow the layout and shift
  // the canvas top edge; we re-measure before every drag below.
  const canvas = page.locator(".konvajs-content").first();
  await expect(canvas).toBeVisible();

  // Helper: drag from world coord A to world coord B. Re-reads the
  // canvas bounding box on every call so the world→pixel math stays
  // accurate even if the toolbar / properties panel resize the canvas
  // between operations.
  async function drag(
    aX: number,
    aY: number,
    bX: number,
    bY: number,
  ): Promise<void> {
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error("canvas not measurable");
    const startX = canvasBox.x + aX * VIEW_SCALE;
    const startY = canvasBox.y + aY * VIEW_SCALE;
    const endX = canvasBox.x + bX * VIEW_SCALE;
    const endY = canvasBox.y + bY * VIEW_SCALE;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Two intermediate moves so Konva's drag detection registers a
    // real drag — a single down→up with no moves sometimes commits
    // as a zero-length click.
    await page.mouse.move(
      startX + (endX - startX) / 3,
      startY + (endY - startY) / 3,
      { steps: 5 },
    );
    await page.mouse.move(endX, endY, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(150);
  }

  // Tool switching via toolbar buttons (clicking title attr) — more
  // reliable than keyboard shortcuts which can drop on focus moves.
  // Buttons have title="<Label> (<Shortcut>)".
  async function pickTool(label: string): Promise<void> {
    await page.locator(`button[title^="${label}"]`).first().click();
  }

  // 1. Walls — re-select the Wall tool between each, because the
  //    editor reverts to `select` after every wall (see onWallAdded).
  for (const w of WALLS) {
    await pickTool("Wall");
    await drag(w.x1, w.y1, w.x2, w.y2);
  }

  // 2. Racks — re-select Storage Location between each. Editor's
  //    onLocationAdded clears the tool back to `select` so the new
  //    rack gets a side-panel for editing.
  for (const r of RACKS) {
    await pickTool("Storage location");
    await drag(r.x, r.y, r.x + r.width, r.y + r.height);
  }

  // 3. Save the batched plan. The Save button is enabled once any
  //    new wall / rack lands in local state.
  const saveBtn = page.getByRole("button", { name: /^save$/i }).last();
  await expect(saveBtn).toBeEnabled({ timeout: 10_000 });

  // Listen for the last POST of a storage location — that's the
  // signal the batched save reached the BE for the last rack.
  const lastCreate = page.waitForResponse(
    (res) =>
      /\/api\/warehouses\/.+\/storage-locations$/.test(res.url()) &&
      res.request().method() === "POST" &&
      res.status() >= 200 &&
      res.status() < 300,
    { timeout: 15_000 },
  );

  await saveBtn.click();
  await lastCreate;

  // After the batched save completes, the button returns to disabled
  // (state clean). Wait for that to confirm every create finished.
  await expect(saveBtn).toBeDisabled({ timeout: 15_000 });
});
