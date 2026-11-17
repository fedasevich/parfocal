import assert from "node:assert/strict";
import { test } from "node:test";
import {
  overviewOfShare,
  shareOfOverview,
  slideExtentOf,
  turnedHost,
} from "../src/screens/viewer-tools/compare-frame.ts";
import { offsetFromRegistration } from "../src/screens/viewer-tools/link-camera.ts";
import { overviewFrame } from "../src/viewer/still-frame.ts";

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);
const wide = overviewFrame({ width: 14_000, height: 9620 });
const pixelOf = (overview: { x: number; y: number }) => ({
  x: overview.x * wide.scale + wide.offsetX,
  y: overview.y * wide.scale + wide.offsetY,
});

test("a compare share is the point's fraction of the real slide, as the engine viewer sends it", () => {
  for (const overview of [
    { x: 700, y: 962 },
    { x: -140, y: 100 },
    { x: 2000, y: 1900 },
  ]) {
    const share = shareOfOverview(overview, wide);
    const pixel = pixelOf(overview);
    near(share.x, pixel.x / 14_000);
    near(share.y, pixel.y / 9620);
    const back = overviewOfShare(share, wide);
    near(back.x, overview.x);
    near(back.y, overview.y);
  }
});

test("without a frame the share falls back to the overview itself", () => {
  const share = shareOfOverview({ x: 350, y: 481 });
  near(share.x, 0.25);
  near(share.y, 0.25);
});

test("a registration shift moves the right pane by that fraction of the real slide", () => {
  const extent = slideExtentOf(wide);
  near(extent.size.width, 2800);
  const centre = { x: 700, y: 962 };
  const offset = offsetFromRegistration(
    { shiftX: 0.1, shiftY: -0.05, rotation: 0, score: 1 },
    extent.size,
    { x: centre.x - extent.left, y: centre.y - extent.top },
  );
  near(offset.x, 280);
  near(offset.y, -0.05 * extent.size.height);
});

test("a turned pane gets a square host that still covers the pane's corners", () => {
  assert.deepEqual(turnedHost(0, { width: 300, height: 400 }), {
    left: 0,
    top: 0,
    width: 300,
    height: 400,
  });
  const turned = turnedHost(15, { width: 300, height: 400 });
  assert.equal(turned.width, 500);
  assert.equal(turned.left, -100);
  assert.equal(turned.top, -50);
  assert.equal(turned.transform, "rotate(15deg)");
});
