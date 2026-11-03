import assert from "node:assert/strict";
import { test } from "node:test";
import { regionShapes } from "../src/screens/review/slide-geometry.ts";
import {
  cueStyle,
  edgeCues,
  mmBetween,
  neighbourTargets,
} from "../src/screens/viewer-tools/edge-cues.ts";
import { cropCentre } from "../src/screens/viewer-tools/tool-geometry.ts";
import { boxCentre } from "../src/screens/viewer-tools/tool-maths.ts";

const size = { width: 1000, height: 800 };
const viewport: [number, number, number, number] = [400, 400, 100, 80];
const pill = { width: 200, height: 30 };
const target = (object: string, centre: [number, number], direction: "back" | "next" = "next") => ({
  object,
  label: object,
  centre,
  direction,
});

const centreOf = (object: string) => {
  const shape = regionShapes[object];
  return shape ? boxCentre(shape.box) : undefined;
};

test("the distance matches the mock for the two areas around the reading view", () => {
  assert.equal(mmBetween(cropCentre.mid, centreOf("T1") ?? [0, 0]).toFixed(1), "12.0");
  assert.equal(mmBetween(cropCentre.mid, centreOf("T3") ?? [0, 0]).toFixed(1), "13.2");
});

test("an area already on screen gets no cue", () => {
  assert.deepEqual(edgeCues(size, viewport, [target("A", [450, 440])], { pill }), []);
});

test("each cue sits on the edge facing its area", () => {
  const cues = edgeCues(
    size,
    viewport,
    [
      target("left", [100, 440]),
      target("right", [900, 440]),
      target("top", [450, 100]),
      target("bottom", [450, 900]),
    ],
    { pill },
  );
  assert.deepEqual(
    cues.map((cue) => [cue.object, cue.side]),
    [
      ["left", "left"],
      ["right", "right"],
      ["top", "top"],
      ["bottom", "bottom"],
    ],
  );
  const [left, right, top, bottom] = cues;
  assert.equal(left?.x, 14 + 100);
  assert.equal(left?.y, 400);
  assert.equal(right?.x, 1000 - 14 - 100);
  assert.equal(top?.y, 14 + 15);
  assert.equal(bottom?.y, 800 - 14 - 15);
});

test("a cue follows the bearing along its edge and stays fully on screen", () => {
  const [cue] = edgeCues(size, viewport, [target("A", [300, 380])], { pill });
  assert.equal(cue?.side, "left");
  assert.ok((cue?.y ?? 0) < 400);
  const [corner] = edgeCues(size, viewport, [target("B", [-5000, -5000])], { pill });
  for (const rect of [corner?.rect ?? [0, 0, 0, 0]]) {
    assert.ok(rect[0] >= 14 && rect[1] >= 14);
    assert.ok(rect[0] + rect[2] <= size.width - 14 && rect[1] + rect[3] <= size.height - 14);
  }
});

test("cues on the same edge are pushed apart instead of overlapping", () => {
  const cues = edgeCues(
    size,
    viewport,
    [target("A", [100, 440]), target("B", [100, 441]), target("C", [100, 439])],
    { pill, gap: 8 },
  );
  const ys = cues.map((cue) => cue.y).sort((a, b) => a - b);
  assert.ok((ys[1] ?? 0) - (ys[0] ?? 0) >= 38);
  assert.ok((ys[2] ?? 0) - (ys[1] ?? 0) >= 38);
});

test("the distance is measured from the centre of the view", () => {
  const [cue] = edgeCues(size, viewport, [target("A", [450 + 1000, 440])], { pill });
  assert.equal(cue?.mm, mmBetween([450, 440], [1450, 440]));
});

test("the cues point to the area before and after the current one", () => {
  const picks = neighbourTargets(["T1", "T2", "T3"], "T2", centreOf);
  assert.deepEqual(
    picks.map((pick) => [pick.object, pick.label, pick.direction]),
    [
      ["T1", "T1", "back"],
      ["T3", "Area 3", "next"],
    ],
  );
  assert.deepEqual(neighbourTargets(["T1"], "T1", centreOf), []);
  assert.deepEqual(neighbourTargets(["T1"], "T9", centreOf), []);
});

test("the cue style anchors the pill to its own edge", () => {
  const [left, right] = edgeCues(
    size,
    viewport,
    [target("L", [100, 440]), target("R", [900, 440])],
    { pill },
  );
  assert.deepEqual(left && cueStyle(left), { left: 14, top: 400, transform: "translateY(-50%)" });
  assert.deepEqual(right && cueStyle(right), {
    right: 14,
    top: 400,
    transform: "translateY(-50%)",
  });
});
