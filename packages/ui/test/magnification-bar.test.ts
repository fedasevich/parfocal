import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type BarSignals,
  calmBar,
  formatMagnification,
  formatReadout,
  isBarOpen,
  magnificationBarRect,
  magnificationPresets,
  msUntilFold,
  nearestMagnificationPreset,
  presetForDigit,
  zoomHoldMs,
} from "../src/lib/magnification-bar.ts";

const signals = (change: Partial<BarSignals>): BarSignals => ({ ...calmBar, ...change });

test("the presets are 1.25, 2.5, 5, 10, 20 and 40 and the digits 1 to 6 pick them in order", () => {
  assert.deepEqual([...magnificationPresets], [1.25, 2.5, 5, 10, 20, 40]);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(presetForDigit), [1.25, 2.5, 5, 10, 20, 40]);
  assert.equal(presetForDigit(0), null);
  assert.equal(presetForDigit(7), null);
});

test("the nearest preset is the one at the smallest ratio, so it highlights between presets", () => {
  assert.equal(nearestMagnificationPreset(1.25), 1.25);
  assert.equal(nearestMagnificationPreset(3), 2.5);
  assert.equal(nearestMagnificationPreset(3.6), 5);
  assert.equal(nearestMagnificationPreset(7), 5);
  assert.equal(nearestMagnificationPreset(7.2), 10);
  assert.equal(nearestMagnificationPreset(14), 10);
  assert.equal(nearestMagnificationPreset(15), 20);
  assert.equal(nearestMagnificationPreset(55), 40);
  assert.equal(nearestMagnificationPreset(0.4), 1.25);
});

test("the label is the objective by default and a percent of the 40x objective when asked", () => {
  assert.equal(formatMagnification(10), "10×");
  assert.equal(formatMagnification(2.5, "objective"), "2.5×");
  assert.deepEqual(
    magnificationPresets.map((preset) => formatMagnification(preset, "zoom-percent")),
    ["3%", "6%", "13%", "25%", "50%", "100%"],
  );
});

test("a calm bar is folded", () => {
  assert.equal(isBarOpen(calmBar, 10_000), false);
  assert.equal(msUntilFold(calmBar, 10_000), null);
});

test("each signal alone opens the bar and dropping it folds the bar back", () => {
  for (const signal of ["hover", "focus", "altHeld", "brightnessOpen"] as const) {
    assert.equal(isBarOpen(signals({ [signal]: true }), 0), true, signal);
    assert.equal(isBarOpen(signals({ [signal]: false }), 0), false, signal);
  }
});

test("a zoom keeps the bar open for 2 s and then folds it", () => {
  const zoomed = signals({ zoomedAt: 1000 });
  assert.equal(zoomHoldMs, 2000);
  assert.equal(isBarOpen(zoomed, 1000), true);
  assert.equal(isBarOpen(zoomed, 2999), true);
  assert.equal(isBarOpen(zoomed, 3000), false);
  assert.equal(msUntilFold(zoomed, 1500), 1500);
  assert.equal(msUntilFold(zoomed, 3000), null);
});

test("the bar stays open past the zoom hold while another signal still holds it", () => {
  const both = signals({ zoomedAt: 0, hover: true });
  assert.equal(isBarOpen(both, 5000), true);
  assert.equal(isBarOpen({ ...both, hover: false }, 5000), false);
  assert.equal(isBarOpen(signals({ zoomedAt: 0, brightnessOpen: true }), 5000), true);
});

test("the blocked area is the folded chip when folded and the wide bar when open", () => {
  const canvas = { width: 1048, height: 856 };
  const folded = magnificationBarRect(canvas, { open: false, brightnessChanged: false });
  const open = magnificationBarRect(canvas, { open: true, brightnessChanged: false });
  assert.deepEqual(folded, [409, 796, 230, 50]);
  assert.ok(open[2] > folded[2]);
  assert.equal(open[0] + open[2] / 2, canvas.width / 2);
  assert.equal(folded[0] + folded[2] / 2, canvas.width / 2);
  assert.ok(open[1] + open[3] <= canvas.height);
});

test("a changed brightness widens the folded chip and the open bar does not depend on it", () => {
  const canvas = { width: 1200, height: 800 };
  const plain = magnificationBarRect(canvas, { open: false, brightnessChanged: false });
  const dimmed = magnificationBarRect(canvas, { open: false, brightnessChanged: true });
  assert.ok(dimmed[2] > plain[2]);
  assert.deepEqual(
    magnificationBarRect(canvas, { open: true, brightnessChanged: true }),
    magnificationBarRect(canvas, { open: true, brightnessChanged: false }),
  );
});

test("the readout shows the objective, the digital label above the scan objective and the microns per pixel", () => {
  assert.equal(formatReadout(20, false, 0.5), "20× · 0.50 µm/px");
  assert.equal(formatReadout(80, true, 0.125), "80× digital · 0.13 µm/px");
  assert.equal(formatReadout(2.5, false, 4), "2.5× · 4.00 µm/px");
});
