import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Camera,
  devicePixelsPerSlidePixel,
  digitalLabel,
  effectiveMagnification,
  formatLength,
  isDigital,
  knownSpacing,
  magnificationReadout,
  micronsPerDevicePixel,
  micronsPerScreenPixel,
  micronsToScreen,
  micronsToSlideLength,
  micronsToSlidePoint,
  nearestObjectivePreset,
  niceScaleBarMicrons,
  objectivePresets,
  scaleBar,
  scanObjective,
  screenToMicrons,
  screenToSlide,
  slideLengthToMicrons,
  slidePointToMicrons,
  slideToScreen,
  viewWidthMicrons,
  zoomForMagnification,
} from "../src/index.ts";

const rect = { left: 100, top: 50, width: 800, height: 600 };
const camera: Camera = { x: 12_000, y: 8_000, zoom: -2 };

const slides = [
  { name: "a 40x scan at 0.25", micronsPerPixel: 0.25, objective: 40 },
  { name: "a 20x scan at 0.499", micronsPerPixel: 0.499, objective: 20 },
  { name: "a 40x scan at 0.2263", micronsPerPixel: 0.2263, objective: 40 },
] as const;

const unknownSpacings = [null, undefined, 0, -0.25, Number.NaN, Number.POSITIVE_INFINITY];

function near(actual: number | null, expected: number, tolerance = 1e-9) {
  assert.notEqual(actual, null);
  assert.ok(
    Math.abs((actual ?? Number.NaN) - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );
}

for (const { name, micronsPerPixel } of slides) {
  test(`level-0 pixels and microns convert both ways on ${name}`, () => {
    near(slideLengthToMicrons(1000, micronsPerPixel), 1000 * micronsPerPixel);
    near(
      micronsToSlideLength(slideLengthToMicrons(1000, micronsPerPixel) ?? 0, micronsPerPixel),
      1000,
    );
    const point = { x: 1234.5, y: 678.25 };
    const microns = slidePointToMicrons(point, micronsPerPixel);
    near(microns?.x ?? null, point.x * micronsPerPixel);
    near(microns?.y ?? null, point.y * micronsPerPixel);
    const back = micronsToSlidePoint(microns ?? { x: 0, y: 0 }, micronsPerPixel);
    near(back?.x ?? null, point.x);
    near(back?.y ?? null, point.y);
  });

  test(`a screen point maps to microns and back through the camera on ${name}`, () => {
    const at = { x: 640, y: 210 };
    const microns = screenToMicrons(camera, rect, at.x, at.y, micronsPerPixel);
    const slide = screenToSlide(camera, rect, at.x, at.y);
    near(microns?.x ?? null, slide.x * micronsPerPixel);
    near(microns?.y ?? null, slide.y * micronsPerPixel);
    const screen = micronsToScreen(camera, rect, microns ?? { x: 0, y: 0 }, micronsPerPixel);
    near(screen?.x ?? null, at.x, 1e-6);
    near(screen?.y ?? null, at.y, 1e-6);
    const direct = slideToScreen(camera, rect, slide);
    near(screen?.x ?? null, direct.x, 1e-6);
  });

  test(`the microns under one screen pixel follow the zoom on ${name}`, () => {
    near(micronsPerScreenPixel(0, micronsPerPixel), micronsPerPixel);
    near(micronsPerScreenPixel(-3, micronsPerPixel), micronsPerPixel * 8);
    near(micronsPerScreenPixel(2, micronsPerPixel), micronsPerPixel / 4);
    near(micronsPerDevicePixel(0, micronsPerPixel, 2), micronsPerPixel / 2);
    near(micronsPerDevicePixel(0, micronsPerPixel, 0), micronsPerPixel);
    near(viewWidthMicrons(rect, -1, micronsPerPixel), 800 * micronsPerPixel * 2);
  });

  test(`the magnification at a zoom is ten microns over the microns per screen pixel on ${name}`, () => {
    for (const zoom of [-6, -2, 0, 1.5, 3]) {
      near(effectiveMagnification(zoom, micronsPerPixel), 10 / (micronsPerPixel / 2 ** zoom), 1e-9);
    }
  });
}

test("device pixels per slide pixel multiply the screen scale by the pixel ratio", () => {
  assert.equal(devicePixelsPerSlidePixel(0, 2), 2);
  assert.equal(devicePixelsPerSlidePixel(-2, 2), 0.5);
  assert.equal(devicePixelsPerSlidePixel(1, Number.NaN), 2);
});

test("the scan objective comes from the microns per pixel", () => {
  for (const { micronsPerPixel, objective } of slides) {
    assert.equal(scanObjective(micronsPerPixel), objective);
  }
  assert.equal(scanObjective(0.5), 20);
  assert.equal(scanObjective(1), 10);
  assert.equal(scanObjective(2), 5);
});

test("a declared objective wins over the one derived from the spacing", () => {
  assert.equal(scanObjective(0.25, 20), 20);
  assert.equal(scanObjective(0.25, null), 40);
  assert.equal(scanObjective(null, 40), 40);
  assert.equal(scanObjective(0.25, Number.POSITIVE_INFINITY), null);
});

test("a spacing far from every objective gives no objective instead of the nearest one", () => {
  assert.equal(scanObjective(100), null);
  assert.equal(scanObjective(0.05), null);
  assert.equal(nearestObjectivePreset(0.1), 1.25);
});

for (const micronsPerPixel of unknownSpacings) {
  test(`an unknown spacing of ${String(micronsPerPixel)} gives no objective, no magnification and no digital label`, () => {
    assert.equal(knownSpacing(micronsPerPixel), null);
    assert.equal(scanObjective(micronsPerPixel), null);
    assert.equal(effectiveMagnification(2, micronsPerPixel), null);
    assert.equal(slideLengthToMicrons(10, micronsPerPixel), null);
    assert.equal(micronsToSlideLength(10, micronsPerPixel), null);
    assert.equal(slidePointToMicrons({ x: 1, y: 2 }, micronsPerPixel), null);
    assert.equal(screenToMicrons(camera, rect, 300, 300, micronsPerPixel), null);
    assert.equal(micronsToScreen(camera, rect, { x: 1, y: 2 }, micronsPerPixel), null);
    assert.equal(micronsPerScreenPixel(0, micronsPerPixel), null);
    assert.equal(viewWidthMicrons(rect, 0, micronsPerPixel), null);
    assert.equal(scaleBar({ zoom: 0, micronsPerPixel, maxWidthPx: 120 }), null);
    assert.deepEqual(magnificationReadout(5, micronsPerPixel), {
      magnification: null,
      scanObjective: null,
      nearestPreset: null,
      digital: false,
    });
  });
}

test("the digital label starts above the scan objective and not on it", () => {
  assert.equal(digitalLabel, "digital");
  for (const { micronsPerPixel, objective } of slides) {
    const onObjective = magnificationReadout(
      zoomForMagnification(micronsPerPixel, objective),
      micronsPerPixel,
    );
    assert.equal(onObjective.scanObjective, objective);
    assert.equal(onObjective.digital, false, `${objective}x on ${micronsPerPixel}`);
    near(onObjective.magnification, objective, 1e-9);

    const above = magnificationReadout(
      zoomForMagnification(micronsPerPixel, objective * 1.01),
      micronsPerPixel,
    );
    assert.equal(above.digital, true, `1% above ${objective}x on ${micronsPerPixel}`);

    const zoomedOut = magnificationReadout(
      zoomForMagnification(micronsPerPixel, objective / 4),
      micronsPerPixel,
    );
    assert.equal(zoomedOut.digital, false);
  }
});

test("every objective preset up to the scan objective is not digital", () => {
  for (const { micronsPerPixel, objective } of slides) {
    for (const preset of objectivePresets) {
      const readout = magnificationReadout(
        zoomForMagnification(micronsPerPixel, preset),
        micronsPerPixel,
      );
      assert.equal(readout.digital, preset > objective, `${preset}x on ${micronsPerPixel}`);
      assert.equal(readout.nearestPreset, preset);
    }
  }
});

test("a 20x scan is digital at 40x and a 40x scan is not", () => {
  assert.equal(magnificationReadout(zoomForMagnification(0.499, 40), 0.499).digital, true);
  assert.equal(magnificationReadout(zoomForMagnification(0.25, 40), 0.25).digital, false);
});

test("at 42x a slide at 0.2263 is digital by the objective rule although it is below its native 44x", () => {
  const readout = magnificationReadout(zoomForMagnification(0.2263, 42), 0.2263);
  assert.equal(readout.scanObjective, 40);
  assert.equal(readout.digital, true);
  near(effectiveMagnification(0, 0.2263), 44.19, 0.01);
});

test("a declared objective moves the digital threshold", () => {
  const zoom = zoomForMagnification(0.25, 30);
  assert.equal(magnificationReadout(zoom, 0.25).digital, false);
  assert.equal(magnificationReadout(zoom, 0.25, 20).digital, true);
});

test("isDigital needs both a magnification and an objective", () => {
  assert.equal(isDigital(null, 40), false);
  assert.equal(isDigital(80, null), false);
  assert.equal(isDigital(40.001, 40), true);
  assert.equal(isDigital(40, 40), false);
});

test("lengths read in microns below a millimetre and in millimetres from 1000 microns", () => {
  assert.equal(formatLength(10), "10 µm");
  assert.equal(formatLength(500), "500 µm");
  assert.equal(formatLength(1000), "1 mm");
  assert.equal(formatLength(2000), "2 mm");
  assert.equal(formatLength(5000), "5 mm");
});

test("the scale bar picks the longest nice length that fits the width", () => {
  const bar = scaleBar({ zoom: 0, micronsPerPixel: 0.25, maxWidthPx: 120 });
  assert.equal(bar?.microns, 20);
  near(bar?.widthPx ?? null, 80);
  assert.equal(bar?.label, "20 µm");
  assert.equal(scaleBar({ zoom: -6, micronsPerPixel: 0.25, maxWidthPx: 120 })?.label, "1 mm");
});

test("the scale bar width equals its microns over the microns per screen pixel at every zoom", () => {
  for (const { micronsPerPixel } of slides) {
    for (let zoom = -10; zoom <= 4; zoom += 0.25) {
      const bar = scaleBar({ zoom, micronsPerPixel, maxWidthPx: 150 });
      assert.ok(bar);
      const perPixel = micronsPerScreenPixel(zoom, micronsPerPixel);
      near(bar.widthPx, bar.microns / (perPixel ?? Number.NaN), 1e-9);
      assert.ok(niceScaleBarMicrons.includes(bar.microns));
      if (
        bar.microns > (niceScaleBarMicrons[0] ?? 0) &&
        bar.microns < (niceScaleBarMicrons.at(-1) ?? 0)
      ) {
        assert.ok(bar.widthPx <= 150);
        const next = niceScaleBarMicrons[niceScaleBarMicrons.indexOf(bar.microns) + 1] ?? 0;
        assert.ok(next / (perPixel ?? 1) > 150, `a longer bar would still fit at zoom ${zoom}`);
      }
    }
  }
});

test("a bar that cannot fit falls back to the shortest length with its true width", () => {
  const bar = scaleBar({ zoom: 4, micronsPerPixel: 0.499, maxWidthPx: 100 });
  assert.equal(bar?.microns, 10);
  assert.ok((bar?.widthPx ?? 0) > 100);
  assert.equal(scaleBar({ zoom: 0, micronsPerPixel: 0.25, maxWidthPx: 0 }), null);
  assert.equal(scaleBar({ zoom: 0, micronsPerPixel: 0.25, maxWidthPx: 100, choices: [] }), null);
});

test("two slides with different spacings show different physical widths at the same camera", () => {
  const fine = viewWidthMicrons(rect, -2, 0.25);
  const coarse = viewWidthMicrons(rect, -2, 0.499);
  near(fine, 800);
  near(coarse, 800 * 0.499 * 4);
  assert.ok((coarse ?? 0) > (fine ?? 0) * 1.99);
});
