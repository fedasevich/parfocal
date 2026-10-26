import { type CDPSession, expect, type Page, test } from "@playwright/test";
import { touchTuning, zoomForMagnification } from "../src/index.ts";
import { harnessUrl } from "./cdp.ts";
import type { InputSetup, RecordedFrame } from "./page/input-harness.ts";

type Camera = RecordedFrame["camera"];

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Finger extends Point {
  readonly id: number;
}

const startCamera: Camera = { x: 40_000, y: 30_000, zoom: -3 };
const micronsPerPixel = 0.25;
const anchorTolerancePx = 1;
const frameGapMs = 8;
const settleMs = 50;
const centre: Point = { x: 500, y: 350 };

const defaults: InputSetup = {
  primaryDragPans: true,
  captureFails: false,
  wheelMode: "auto",
  camera: startCamera,
};

test.use({ hasTouch: true });

class Fingers {
  readonly page: Page;
  readonly cdp: CDPSession;
  private down = new Map<number, Point>();

  constructor(page: Page, cdp: CDPSession) {
    this.page = page;
    this.cdp = cdp;
  }

  private points(): Array<{ x: number; y: number; id: number }> {
    return [...this.down.entries()].map(([id, p]) => ({ x: p.x, y: p.y, id }));
  }

  async touchStart(...fingers: Finger[]) {
    for (const finger of fingers) this.down.set(finger.id, finger);
    await this.cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: this.points(),
    });
  }

  async touchMove(...fingers: Finger[]) {
    for (const finger of fingers) this.down.set(finger.id, finger);
    await this.cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: this.points(),
    });
  }

  async touchEnd(...ids: number[]) {
    const ended = this.points().filter((point) => ids.includes(point.id));
    for (const id of ids) this.down.delete(id);
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: ended });
  }

  async touchCancel() {
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    this.down.clear();
  }

  async swipe(from: Point, to: Point, steps: number, settle = true) {
    await this.touchStart({ ...from, id: 1 });
    for (let step = 1; step <= steps; step++) {
      const progress = step / steps;
      await this.touchMove({
        id: 1,
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress,
      });
      await this.page.waitForTimeout(frameGapMs);
    }
    if (settle) await this.page.waitForTimeout(settleMs);
  }

  async tap(at: Point, holdMs = 40) {
    await this.touchStart({ ...at, id: 1 });
    await this.page.waitForTimeout(holdMs);
    await this.touchEnd(1);
  }

  async twoFingerTap(holdMs = 40) {
    await this.touchStart(
      { x: centre.x - 60, y: centre.y, id: 1 },
      { x: centre.x + 60, y: centre.y, id: 2 },
    );
    await this.page.waitForTimeout(holdMs);
    await this.touchEnd(1, 2);
  }

  async pinch(spreadFrom: number, spreadTo: number, steps: number, drift: Point = { x: 0, y: 0 }) {
    const at = (spread: number, progress: number) => ({
      left: {
        x: centre.x - spread / 2 + drift.x * progress,
        y: centre.y + drift.y * progress,
        id: 1,
      },
      right: {
        x: centre.x + spread / 2 + drift.x * progress,
        y: centre.y + drift.y * progress,
        id: 2,
      },
    });
    const start = at(spreadFrom, 0);
    await this.touchStart(start.left, start.right);
    for (let step = 1; step <= steps; step++) {
      const progress = step / steps;
      const next = at(spreadFrom + (spreadTo - spreadFrom) * progress, progress);
      await this.touchMove(next.left, next.right);
      await this.page.waitForTimeout(frameGapMs);
    }
    await this.page.waitForTimeout(settleMs);
  }
}

async function open(page: Page, options: Partial<InputSetup> = {}): Promise<Fingers> {
  await page.goto(harnessUrl("/app/input.html"));
  await page.waitForFunction(() => window.inputHarness !== undefined);
  await page.evaluate((setup) => window.inputHarness.setup(setup), { ...defaults, ...options });
  return new Fingers(page, await page.context().newCDPSession(page));
}

const camera = (page: Page) => page.evaluate(() => window.inputHarness.camera());
const whenIdle = (page: Page) => page.evaluate(() => window.inputHarness.whenIdle(5000));
const startRecording = (page: Page) => page.evaluate(() => window.inputHarness.startRecording());
const stopRecording = (page: Page) => page.evaluate(() => window.inputHarness.stopRecording());
const viewerRect = (page: Page) => page.evaluate(() => window.inputHarness.rect());

function slideUnder(
  view: Camera,
  rect: { left: number; top: number; width: number; height: number },
  at: Point,
): Point {
  const scale = 2 ** view.zoom;
  return {
    x: view.x + (at.x - rect.left - rect.width / 2) / scale,
    y: view.y + (at.y - rect.top - rect.height / 2) / scale,
  };
}

function screenOf(
  view: Camera,
  rect: { left: number; top: number; width: number; height: number },
  point: Point,
): Point {
  const scale = 2 ** view.zoom;
  return {
    x: rect.left + rect.width / 2 + (point.x - view.x) * scale,
    y: rect.top + rect.height / 2 + (point.y - view.y) * scale,
  };
}

async function expectAnchored(
  page: Page,
  frames: readonly RecordedFrame[],
  before: Camera,
  at: Point,
) {
  const rect = await viewerRect(page);
  const point = slideUnder(before, rect, at);
  let worst = 0;
  for (const frame of frames) {
    const screen = screenOf(frame.camera, rect, point);
    worst = Math.max(worst, Math.hypot(screen.x - at.x, screen.y - at.y));
  }
  expect(worst, "the slide point under the fingers drifted").toBeLessThan(anchorTolerancePx);
}

async function expectIdleAndReleased(page: Page) {
  await whenIdle(page);
  expect(await page.evaluate(() => window.inputHarness.motion())).toBe("idle");
  expect(await page.evaluate(() => window.inputHarness.gesture())).toBe("none");
}

test("the touch stream reaches the page as touch pointers", async ({ page }) => {
  const fingers = await open(page);
  await fingers.tap(centre);
  expect(await page.evaluate(() => window.inputHarness.touchPointerDowns())).toBe(1);
});

test("one finger pans the slide with the content following the finger", async ({ page }) => {
  const fingers = await open(page);
  const before = await camera(page);
  await fingers.swipe({ x: 600, y: 350 }, { x: 400, y: 300 }, 10);
  expect(await page.evaluate(() => window.inputHarness.gesture())).toBe("drag");
  const during = await camera(page);
  const scale = 2 ** before.zoom;
  expect(during.x - before.x).toBeCloseTo(200 / scale, 0);
  expect(during.y - before.y).toBeCloseTo(50 / scale, 0);
  await fingers.touchEnd(1);
  await expectIdleAndReleased(page);
});

test("a flick keeps coasting after the finger lifts and then settles", async ({ page }) => {
  const fingers = await open(page);
  await fingers.swipe({ x: 700, y: 350 }, { x: 300, y: 350 }, 20, false);
  const atRelease = await camera(page);
  await startRecording(page);
  await fingers.touchEnd(1);
  await whenIdle(page);
  const frames = await stopRecording(page);
  const after = await camera(page);
  expect(frames.some((frame) => frame.motion === "coasting")).toBe(true);
  expect(after.x - atRelease.x, "coast distance in slide pixels").toBeGreaterThan(0);
  await expectIdleAndReleased(page);
});

test("a slow drag that rests before lifting does not coast", async ({ page }) => {
  const fingers = await open(page);
  await fingers.swipe({ x: 700, y: 350 }, { x: 600, y: 350 }, 10);
  await page.waitForTimeout(300);
  const atRelease = await camera(page);
  await fingers.touchEnd(1);
  await expectIdleAndReleased(page);
  expect(await camera(page)).toEqual(atRelease);
});

test("two fingers pinch about their midpoint and keep the point under it fixed", async ({
  page,
}) => {
  const fingers = await open(page);
  const before = await camera(page);
  await startRecording(page);
  await fingers.pinch(100, 300, 15);
  const frames = await stopRecording(page);
  const after = await camera(page);
  expect(await page.evaluate(() => window.inputHarness.gesture())).toBe("pinch");
  expect(after.zoom - before.zoom).toBeCloseTo(Math.log2(3), 1);
  await expectAnchored(page, frames, before, centre);
  await fingers.touchEnd(1, 2);
  await expectIdleAndReleased(page);
});

test("a pinch that closes zooms out", async ({ page }) => {
  const fingers = await open(page);
  const before = await camera(page);
  await fingers.pinch(300, 150, 10);
  const after = await camera(page);
  expect(after.zoom - before.zoom).toBeCloseTo(-1, 1);
  await fingers.touchEnd(1, 2);
  await expectIdleAndReleased(page);
});

test("two fingers that move together pan about their midpoint", async ({ page }) => {
  const fingers = await open(page);
  const before = await camera(page);
  await fingers.pinch(200, 200, 10, { x: -120, y: 40 });
  const after = await camera(page);
  const scale = 2 ** before.zoom;
  expect(after.zoom).toBeCloseTo(before.zoom, 6);
  expect(after.x - before.x).toBeCloseTo(120 / scale, 0);
  expect(after.y - before.y).toBeCloseTo(-40 / scale, 0);
  await fingers.touchEnd(1, 2);
  await expectIdleAndReleased(page);
});

test("lifting one finger of a pinch turns it into a pan without a jump", async ({ page }) => {
  const fingers = await open(page);
  await fingers.pinch(100, 260, 10);
  const beforeLift = await camera(page);
  await fingers.touchEnd(2);
  expect(await page.evaluate(() => window.inputHarness.gesture())).toBe("drag");
  expect(await camera(page)).toEqual(beforeLift);
  const remaining = { x: centre.x - 130, y: centre.y };
  await fingers.touchMove({ ...remaining, x: remaining.x - 60, id: 1 });
  await page.waitForTimeout(40);
  const panned = await camera(page);
  const scale = 2 ** beforeLift.zoom;
  expect(panned.zoom).toBeCloseTo(beforeLift.zoom, 6);
  expect(panned.x - beforeLift.x).toBeCloseTo(60 / scale, 0);
  await page.waitForTimeout(300);
  await fingers.touchEnd(1);
  await expectIdleAndReleased(page);
});

test("a double tap zooms to 40x about the tap and the browser double click adds nothing", async ({
  page,
}) => {
  const fingers = await open(page);
  const before = await camera(page);
  const rect = await viewerRect(page);
  const target = { x: 640, y: 260 };
  const underTap = slideUnder(before, rect, target);
  await startRecording(page);
  await fingers.tap(target);
  await page.waitForTimeout(80);
  await fingers.tap(target);
  await whenIdle(page);
  const frames = await stopRecording(page);
  const after = await camera(page);
  expect(after.zoom).toBeCloseTo(zoomForMagnification(micronsPerPixel, 40), 6);
  expect(frames.filter((frame) => frame.motion === "zooming").length).toBeGreaterThan(3);
  const settled = screenOf(after, rect, underTap);
  expect(Math.hypot(settled.x - target.x, settled.y - target.y)).toBeLessThan(anchorTolerancePx);
  await expectIdleAndReleased(page);
});

test("a single tap and two slow taps leave the camera alone", async ({ page }) => {
  const fingers = await open(page);
  const before = await camera(page);
  await fingers.tap(centre);
  await page.waitForTimeout(touchTuning.doubleTapWindowMs + 100);
  await fingers.tap(centre);
  await page.waitForTimeout(touchTuning.doubleTapWindowMs + 100);
  await whenIdle(page);
  expect(await camera(page)).toEqual(before);
});

test("a tap pair with a drag in the second tap leaves the zoom alone", async ({ page }) => {
  const fingers = await open(page);
  const before = await camera(page);
  await fingers.tap(centre);
  await page.waitForTimeout(80);
  await fingers.swipe(centre, { x: centre.x + 80, y: centre.y }, 6);
  await fingers.touchEnd(1);
  await whenIdle(page);
  expect((await camera(page)).zoom).toBeCloseTo(before.zoom, 6);
});

test("a two-finger double tap flies to the whole slide through the tissue-aware fit", async ({
  page,
}) => {
  const fingers = await open(page, { camera: { x: 20_000, y: 15_000, zoom: -1 } });
  const fit = await page.evaluate(() => window.inputHarness.fitReference());
  await startRecording(page);
  await fingers.twoFingerTap();
  await page.waitForTimeout(80);
  await fingers.twoFingerTap();
  await whenIdle(page);
  const frames = await stopRecording(page);
  const after = await camera(page);
  expect(after.x).toBeCloseTo(fit.x, 3);
  expect(after.y).toBeCloseTo(fit.y, 3);
  expect(after.zoom).toBeCloseTo(fit.zoom, 6);
  expect(frames.filter((frame) => frame.motion === "flying").length).toBeGreaterThan(3);
  await expectIdleAndReleased(page);
});

test("a touch that the browser cancels ends the drag where it was and does not coast", async ({
  page,
}) => {
  const fingers = await open(page);
  await fingers.swipe({ x: 700, y: 350 }, { x: 300, y: 350 }, 20);
  const atCancel = await camera(page);
  await fingers.touchCancel();
  await expectIdleAndReleased(page);
  expect(await camera(page)).toEqual(atCancel);
  await fingers.swipe({ x: 500, y: 350 }, { x: 450, y: 350 }, 5);
  await fingers.touchEnd(1);
  await expectIdleAndReleased(page);
  expect((await camera(page)).x).toBeGreaterThan(atCancel.x);
});

test("a cancelled touch also forgets the first tap of a double tap", async ({ page }) => {
  const fingers = await open(page);
  const before = await camera(page);
  await fingers.tap(centre);
  await page.waitForTimeout(60);
  await fingers.touchStart({ ...centre, id: 1 });
  await fingers.touchCancel();
  await page.waitForTimeout(60);
  await fingers.tap(centre);
  await whenIdle(page);
  expect((await camera(page)).zoom).toBeCloseTo(before.zoom, 6);
});
