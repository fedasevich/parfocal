import { type CDPSession, expect, type Page, test } from "@playwright/test";
import { defaultCameraProfile } from "../src/index.ts";

const maxWheelOctaves = defaultCameraProfile.maxOctavesPerEvent;

import { harnessUrl } from "./cdp.ts";
import type { InputSetup, RecordedFrame } from "./page/input-harness.ts";

type Camera = RecordedFrame["camera"];

interface Point {
  readonly x: number;
  readonly y: number;
}

const startCamera: Camera = { x: 40_000, y: 30_000, zoom: -3 };
const anchorTolerancePx = 0.5;
const dragFrameLimitPx = 120;
const idleWindowMs = 500;
const ctrl = 2;
const alt = 1;

const defaults: InputSetup = {
  primaryDragPans: true,
  captureFails: false,
  wheelMode: "auto",
  camera: startCamera,
};

type MouseButton = "none" | "left" | "middle" | "right";

const buttonBits: Record<MouseButton, number> = { none: 0, left: 1, right: 2, middle: 4 };

class Driver {
  readonly page: Page;
  readonly cdp: CDPSession;
  private held: MouseButton = "none";

  constructor(page: Page, cdp: CDPSession) {
    this.page = page;
    this.cdp = cdp;
  }

  async move(to: Point, modifiers = 0) {
    await this.cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: to.x,
      y: to.y,
      button: this.held,
      buttons: buttonBits[this.held],
      modifiers,
    });
  }

  async down(at: Point, button: MouseButton = "left", clickCount = 1, modifiers = 0) {
    await this.move(at, modifiers);
    this.held = button;
    await this.cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: at.x,
      y: at.y,
      button,
      buttons: buttonBits[button],
      clickCount,
      modifiers,
    });
  }

  async up(at: Point, clickCount = 1, modifiers = 0) {
    const button = this.held;
    this.held = "none";
    await this.cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: at.x,
      y: at.y,
      button,
      buttons: 0,
      clickCount,
      modifiers,
    });
  }

  async stroke(from: Point, to: Point, steps: number, frameGapMs = 8) {
    for (let step = 1; step <= steps; step++) {
      const progress = step / steps;
      await this.move({
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress,
      });
      if (frameGapMs > 0) await this.page.waitForTimeout(frameGapMs);
    }
  }

  async wheel(at: Point, deltaY: number, modifiers = 0, deltaX = 0) {
    await this.cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: at.x,
      y: at.y,
      deltaX,
      deltaY,
      modifiers,
    });
  }

  async doubleClick(at: Point, modifiers = 0) {
    await this.down(at, "left", 1, modifiers);
    await this.up(at, 1, modifiers);
    await this.down(at, "left", 2, modifiers);
    await this.up(at, 2, modifiers);
  }
}

async function open(page: Page, options: Partial<InputSetup> = {}): Promise<Driver> {
  await page.goto(harnessUrl("/app/input.html"));
  await page.waitForFunction(() => window.inputHarness !== undefined);
  await page.evaluate((setup) => window.inputHarness.setup(setup), { ...defaults, ...options });
  return new Driver(page, await page.context().newCDPSession(page));
}

const camera = (page: Page) => page.evaluate(() => window.inputHarness.camera());
const whenIdle = (page: Page) => page.evaluate(() => window.inputHarness.whenIdle(5000));
const startRecording = (page: Page) => page.evaluate(() => window.inputHarness.startRecording());
const stopRecording = (page: Page) => page.evaluate(() => window.inputHarness.stopRecording());

async function viewerRect(page: Page) {
  return page.evaluate(() => window.inputHarness.rect());
}

function slideUnder(
  view: Camera,
  rect: { left: number; top: number; width: number; height: number },
  at: Point,
) {
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
  expect(worst, "the slide point under the cursor drifted").toBeLessThan(anchorTolerancePx);
}

function largestZoomStep(frames: readonly RecordedFrame[], from: Camera): number {
  let previous = from;
  let largest = 0;
  for (const frame of frames) {
    largest = Math.max(largest, Math.abs(frame.camera.zoom - previous.zoom));
    previous = frame.camera;
  }
  return largest;
}

function largestPanStep(frames: readonly RecordedFrame[], from: Camera): number {
  let previous = from;
  let largest = 0;
  for (const frame of frames) {
    const scale = 2 ** frame.camera.zoom;
    largest = Math.max(
      largest,
      Math.hypot((frame.camera.x - previous.x) * scale, (frame.camera.y - previous.y) * scale),
    );
    previous = frame.camera;
  }
  return largest;
}

async function expectLoopIdle(page: Page) {
  await whenIdle(page);
  const before = await page.evaluate(() => window.inputHarness.engineFrames());
  await page.waitForTimeout(idleWindowMs);
  const after = await page.evaluate(() => window.inputHarness.engineFrames());
  expect(after - before, "engine frames while idle").toBe(0);
  expect(await page.evaluate(() => window.inputHarness.motion())).toBe("idle");
  expect(await page.evaluate(() => window.inputHarness.gesture())).toBe("none");
}

async function expectNoPanOnNextMove(page: Page, driver: Driver, path: readonly Point[]) {
  await whenIdle(page);
  const rested = await camera(page);
  for (const point of path) await driver.move(point);
  await page.waitForTimeout(50);
  expect(await camera(page)).toEqual(rested);
}

const inside: Point = { x: 400, y: 350 };
const anchor: Point = { x: 620, y: 260 };

test("the viewer sets touch-action, user-select, overscroll and a grab cursor", async ({
  page,
}) => {
  const driver = await open(page);
  expect(await page.evaluate(() => window.inputHarness.style())).toEqual({
    touchAction: "none",
    userSelect: "none",
    cursor: "grab",
    overscroll: "none",
  });
  await driver.down(inside);
  await driver.stroke(inside, { x: 450, y: 350 }, 5);
  expect((await page.evaluate(() => window.inputHarness.style())).cursor).toBe("grabbing");
  await driver.up({ x: 450, y: 350 });
  expect((await page.evaluate(() => window.inputHarness.style())).cursor).toBe("grab");
  await expectLoopIdle(page);
});

test("wheel notches zoom eased about the cursor without a jump and then the loop goes idle", async ({
  page,
}) => {
  const driver = await open(page);
  const before = await camera(page);
  await startRecording(page);
  for (let notch = 0; notch < 3; notch++) {
    await driver.wheel(anchor, -100);
    await page.waitForTimeout(40);
  }
  await whenIdle(page);
  const frames = await stopRecording(page);
  const expected = 3 * 100 * defaultCameraProfile.wheelOctavesPerPixel;
  const after = await camera(page);
  expect(after.zoom - before.zoom).toBeCloseTo(expected, 6);
  expect(frames.filter((frame) => frame.motion === "zooming").length).toBeGreaterThan(3);
  expect(largestZoomStep(frames, before)).toBeLessThanOrEqual(maxWheelOctaves);
  await expectAnchored(page, frames, before, anchor);
  await expectLoopIdle(page);
});

test("a Ctrl+wheel pinch stream zooms without easing about the cursor", async ({ page }) => {
  const driver = await open(page);
  const before = await camera(page);
  await startRecording(page);
  for (let step = 0; step < 20; step++) {
    await driver.wheel(anchor, -2.5, ctrl);
    await page.waitForTimeout(8);
  }
  await whenIdle(page);
  const frames = await stopRecording(page);
  const after = await camera(page);
  expect(after.zoom).toBeGreaterThan(before.zoom);
  expect(frames.some((frame) => frame.motion === "zooming")).toBe(false);
  expect(largestZoomStep(frames, before)).toBeLessThanOrEqual(maxWheelOctaves);
  await expectAnchored(page, frames, before, anchor);
  await expectLoopIdle(page);
});

test("a huge wheel flick moves the zoom by half an octave at most", async ({ page }) => {
  const driver = await open(page);
  const before = await camera(page);
  await driver.wheel(anchor, -4000);
  await whenIdle(page);
  expect((await camera(page)).zoom - before.zoom).toBeCloseTo(maxWheelOctaves, 6);
});

test("a trackpad scroll pans in auto mode and Shift+wheel pans sideways in pan mode", async ({
  page,
}) => {
  const driver = await open(page);
  const before = await camera(page);
  for (let step = 0; step < 6; step++) await driver.wheel(anchor, 7.5, 0, 0.5);
  await whenIdle(page);
  const scrolled = await camera(page);
  expect(scrolled.zoom).toBe(before.zoom);
  expect(scrolled.y).toBeGreaterThan(before.y);

  await page.evaluate((setup) => window.inputHarness.setup(setup), {
    ...defaults,
    wheelMode: "pan" as const,
  });
  const panStart = await camera(page);
  await driver.wheel(anchor, 100, 8);
  await whenIdle(page);
  const sideways = await camera(page);
  expect(sideways.zoom).toBe(panStart.zoom);
  expect(sideways.y).toBe(panStart.y);
  expect(sideways.x).not.toBe(panStart.x);
});

test("a drag pans with the pointer, coasts without a frame jump and goes idle", async ({
  page,
}) => {
  const driver = await open(page);
  const before = await camera(page);
  await startRecording(page);
  await driver.down(inside);
  await driver.stroke(inside, { x: 600, y: 420 }, 25);
  await driver.up({ x: 600, y: 420 });
  await whenIdle(page);
  const frames = await stopRecording(page);
  const after = await camera(page);
  const scale = 2 ** before.zoom;
  expect((before.x - after.x) * scale).toBeGreaterThanOrEqual(200 - 1e-6);
  expect(largestPanStep(frames, before)).toBeLessThan(dragFrameLimitPx);
  await expectLoopIdle(page);
});

test("middle-drag pans in any tool and Space+drag pans through the hook", async ({ page }) => {
  const driver = await open(page, { primaryDragPans: false });
  const start = await camera(page);
  await driver.down(inside);
  await driver.stroke(inside, { x: 500, y: 350 }, 10, 0);
  await driver.up({ x: 500, y: 350 });
  await whenIdle(page);
  expect(await camera(page)).toEqual(start);

  await driver.down(inside, "middle");
  await driver.stroke(inside, { x: 500, y: 350 }, 10, 20);
  await driver.up({ x: 500, y: 350 });
  await whenIdle(page);
  const middle = await camera(page);
  expect((start.x - middle.x) * 2 ** start.zoom).toBeGreaterThanOrEqual(100 - 1e-6);
  expect(middle.y).toBe(start.y);

  await page.keyboard.down("Space");
  await driver.down(inside);
  await driver.stroke(inside, { x: 400, y: 450 }, 10, 20);
  await driver.up({ x: 400, y: 450 });
  await page.keyboard.up("Space");
  await whenIdle(page);
  const spaced = await camera(page);
  expect((middle.y - spaced.y) * 2 ** start.zoom).toBeGreaterThanOrEqual(100 - 1e-6);
  expect(spaced.x).toBe(middle.x);
  await expectLoopIdle(page);
});

test("double-click zooms in 2x about the cursor and Alt+double-click zooms out 2x", async ({
  page,
}) => {
  const driver = await open(page);
  const before = await camera(page);
  await startRecording(page);
  await driver.doubleClick(anchor);
  await whenIdle(page);
  const zoomedIn = await camera(page);
  expect(zoomedIn.zoom - before.zoom).toBeCloseTo(1, 6);
  await driver.doubleClick(anchor, alt);
  await whenIdle(page);
  const frames = await stopRecording(page);
  expect((await camera(page)).zoom).toBeCloseTo(before.zoom, 6);
  await expectAnchored(page, frames, before, anchor);
  await expectLoopIdle(page);
});

test("a two-finger touch pinch zooms about the midpoint", async ({ page }) => {
  const driver = await open(page);
  await driver.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
  const before = await camera(page);
  const centre = { x: 500, y: 350 };
  const fingers = (spread: number) => [
    { x: centre.x - spread, y: centre.y, id: 1 },
    { x: centre.x + spread, y: centre.y, id: 2 },
  ];
  await driver.cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: fingers(50),
  });
  for (let spread = 55; spread <= 100; spread += 5) {
    await driver.cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: fingers(spread),
    });
  }
  await driver.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await whenIdle(page);
  const after = await camera(page);
  expect(after.zoom - before.zoom).toBeCloseTo(1, 1);
  const rect = await viewerRect(page);
  const held = screenOf(after, rect, slideUnder(before, rect, centre));
  expect(Math.hypot(held.x - centre.x, held.y - centre.y)).toBeLessThan(2);
  await expectLoopIdle(page);
});

for (const captureFails of [false, true]) {
  const how = captureFails ? "when pointer capture is refused" : "with pointer capture";
  test.describe(`drags that always end ${how}`, () => {
    test("release outside the viewer", async ({ page }) => {
      const driver = await open(page, { captureFails });
      await driver.down(inside);
      await driver.stroke(inside, { x: 1100, y: 360 }, 20);
      await driver.up({ x: 1100, y: 360 });
      await expectNoPanOnNextMove(page, driver, [{ x: 1000, y: 360 }, inside, { x: 300, y: 200 }]);
      await expectLoopIdle(page);
    });

    test("release over an overlay with pointer-events none", async ({ page }) => {
      const driver = await open(page, { captureFails });
      const readout = { x: 740, y: 560 };
      await driver.down(inside);
      await driver.stroke(inside, readout, 20);
      await driver.up(readout);
      await expectNoPanOnNextMove(page, driver, [{ x: 700, y: 540 }, inside]);
      await expectLoopIdle(page);
    });

    test("release over a panel that takes pointer events", async ({ page }) => {
      const driver = await open(page, { captureFails });
      const panel = { x: 820, y: 200 };
      await driver.down(inside);
      await driver.stroke(inside, panel, 20);
      await driver.up(panel);
      await expectNoPanOnNextMove(page, driver, [{ x: 780, y: 220 }, inside]);
      await expectLoopIdle(page);
    });

    test("window blur in the middle of a drag", async ({ page }) => {
      const driver = await open(page, { captureFails });
      await driver.down(inside);
      await driver.stroke(inside, { x: 500, y: 380 }, 10);
      await page.evaluate(() => window.inputHarness.blurWindow());
      expect(await page.evaluate(() => window.inputHarness.gesture())).toBe("none");
      await expectNoPanOnNextMove(page, driver, [
        { x: 560, y: 400 },
        { x: 620, y: 420 },
      ]);
      await driver.up({ x: 620, y: 420 });
      await expectLoopIdle(page);
    });
  });
}

test("a lost pointer capture ends the drag", async ({ page }) => {
  const driver = await open(page);
  await driver.down(inside);
  await driver.stroke(inside, { x: 500, y: 380 }, 10);
  expect(await page.evaluate(() => window.inputHarness.hasCapture())).toBe(true);
  const held = await camera(page);
  expect(await page.evaluate(() => window.inputHarness.releaseCapture())).toBe(true);
  for (const point of [
    { x: 560, y: 400 },
    { x: 620, y: 420 },
  ])
    await driver.move(point);
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => window.inputHarness.gesture())).toBe("none");
  expect(await camera(page)).toEqual(held);
  await driver.up({ x: 620, y: 420 });
  await expectLoopIdle(page);
});
