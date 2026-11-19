import assert from "node:assert/strict";
import { test } from "node:test";
import { calmStep, landingCamera, landingPower } from "../src/viewer/calm-camera.ts";

const view = { width: 1000, height: 800, bottomInset: 200 };
const camera = { x: 5000, y: 5000, zoom: 0 };

test("a cell inside the inner 65 percent of the clear view leaves the camera alone", () => {
  assert.deepEqual(calmStep(camera, view, { x: 5300, y: 4950, size: 24 }), { kind: "stay" });
  assert.deepEqual(calmStep(camera, view, { x: 4700, y: 5090, size: 24 }), { kind: "stay" });
});

test("a cell outside it is centred above the strip at the same zoom", () => {
  assert.deepEqual(calmStep(camera, view, { x: 5400, y: 5000, size: 24 }), {
    kind: "pan",
    camera: { x: 5400, y: 5100, zoom: 0 },
  });
  assert.equal(calmStep(camera, view, { x: 5000, y: 5120, size: 24 }).kind, "pan");
});

test("the strip's height counts, so a cell behind it is not comfortable", () => {
  const open = { ...view, bottomInset: 0 };
  assert.equal(calmStep(camera, open, { x: 5000, y: 5200, size: 24 }).kind, "stay");
  assert.equal(calmStep(camera, view, { x: 5000, y: 5200, size: 24 }).kind, "pan");
});

test("a cell too small or too large to judge flies and fits as before", () => {
  const out = { ...camera, zoom: -2 };
  assert.deepEqual(calmStep(out, view, { x: 5010, y: 5010, size: 24 }), { kind: "fly" });
  const close = { ...camera, zoom: 4 };
  assert.deepEqual(calmStep(close, view, { x: 5001, y: 5001, size: 24 }), { kind: "fly" });
  assert.deepEqual(
    calmStep(camera, { width: 0, height: 0, bottomInset: 0 }, { x: 1, y: 1, size: 24 }),
    {
      kind: "fly",
    },
  );
});

test("a flight lands at 40x, or at the scan power when the slide is scanned lower", () => {
  assert.equal(landingPower(40), 40);
  assert.equal(landingPower(80), 40);
  assert.equal(landingPower(20), 20);
  assert.equal(landingPower(null), null);
  assert.equal(landingPower(0), null);
});

test("the landing keeps the cell centred above the strip at the landing zoom", () => {
  assert.deepEqual(landingCamera(view, { x: 300, y: 400 }, 1), { x: 300, y: 450, zoom: 1 });
  assert.deepEqual(landingCamera(null, { x: 300, y: 400 }, -1), { x: 300, y: 400, zoom: -1 });
});
