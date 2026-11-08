import assert from "node:assert/strict";
import { test } from "node:test";
import { minimapBox } from "@parfocal/ui/lib/minimap-box";
import { placeMinimap } from "../src/screens/viewer-tools/minimap-placement.ts";
import {
  annotateHome,
  annotateSpots,
  focusHome,
  focusSpots,
  mapBoxOf,
  type NavigatorMapScene,
  navigatorLookOf,
  navigatorSpots,
  viewerSpots,
} from "../src/screens/viewer-tools/minimap-scenes.ts";
import { hotWeight } from "../src/screens/viewer-tools/minimap-weights.ts";

const size = { width: 1048, height: 856 };
const areaObjects = ["T1", "T2", "T3", "T4", "T5"];

const navigator = (scene: NavigatorMapScene, chrome = {}) => {
  const camera = navigatorLookOf(scene).home(size);
  return navigatorSpots(
    scene,
    camera,
    size,
    { areaObjects, current: "T2", barOpen: false },
    chrome,
  );
};

const cornerOf = (spots: ReturnType<typeof navigator>) =>
  placeMinimap(size, mapBoxOf(spots), spots.hot, spots.blocked).corner;

test("the reading scene keeps the bottom right with the tumor edge and the cues around it", () => {
  const spots = navigator("reading");
  assert.ok(spots.hot.length > 10);
  assert.ok(spots.hot.every((spot) => spot[2] === hotWeight.tumorEdge));
  assert.equal(cornerOf(spots), "bottom-right");
});

test("the travel scene keeps the bottom right and makes the map wide", () => {
  const spots = navigator("travel");
  assert.equal(spots.size, "travel");
  assert.equal(cornerOf(spots), "bottom-right");
});

test("the measuring scene weighs the eleven ruler samples and leaves the bottom right", () => {
  const spots = navigator("avoid");
  assert.equal(spots.hot.filter((spot) => spot[2] === hotWeight.measurementSample).length, 11);
  assert.notEqual(cornerOf(spots), "bottom-right");
});

test("the cells scene weighs the current cell at 50 and the other five at 4", () => {
  const spots = navigator("cells");
  assert.equal(spots.size, "compact");
  assert.equal(spots.hot.filter((spot) => spot[2] === hotWeight.currentCell).length, 1);
  assert.equal(spots.hot.filter((spot) => spot[2] === hotWeight.cellToCheck).length, 5);
  assert.equal(cornerOf(spots), "bottom-right");
});

test("the one-cell scene uses the pip map and blocks the decision card strip", () => {
  const spots = navigator("focus");
  assert.equal(spots.size, "pip");
  assert.ok(spots.blocked.some((rect) => rect[2] === 580));
  assert.equal(cornerOf(spots), "bottom-right");
});

test("the annotate scene weighs each proposal at 5 and blocks the prompt box", () => {
  const spots = annotateSpots(annotateHome(size), size);
  assert.ok(spots.hot.length > 0);
  assert.ok(spots.hot.every((spot) => spot[2] === hotWeight.proposal));
  assert.equal(spots.size, "compact");
  assert.equal(spots.blocked.length, 3);
  assert.equal(cornerOf({ ...spots, cues: [] }), "bottom-right");
});

test("an open thread or the cells panel pushes the annotate map out of their corner", () => {
  const camera = annotateHome(size);
  const bottomRight = placeMinimap(
    size,
    minimapBox("compact", annotateSpots(camera, size).extent),
    [],
    [],
  );
  assert.equal(bottomRight.corner, "bottom-right");
  const thread = annotateSpots(camera, size, {
    openThread: [size.width - 330, size.height - 300, 316, 280],
  });
  assert.notEqual(
    placeMinimap(size, mapBoxOf(thread), thread.hot, thread.blocked).corner,
    "bottom-right",
  );
  const panel = annotateSpots(camera, size, { cellsPanel: [0, size.height - 300, 260, 300] });
  assert.equal(panel.blocked.length, 4);
});

test("the focus view leaves the corner of the decision card", () => {
  const spots = focusSpots(focusHome(size), size);
  assert.ok(spots.hot.every((spot) => spot[2] === hotWeight.tumorEdge));
  const corner = placeMinimap(size, mapBoxOf(spots), spots.hot, spots.blocked).corner;
  assert.notEqual(corner, "bottom-right");
});

const viewerInput = {
  camera: { x: 800, y: 500, scale: 1 },
  size,
  blockLeft: false,
  blockToast: false,
  cells: [],
  currentCell: undefined,
  pins: [],
  proposals: [],
  openThread: null,
  cellsPanel: null,
};

test("the viewer weighs pins at 20 and blocks the open thread and the cells panel", () => {
  const spots = viewerSpots({
    ...viewerInput,
    pins: [{ x: 820, y: 520 }],
    openThread: [700, 100, 316, 280],
    cellsPanel: [300, 700, 440, 120],
  });
  assert.deepEqual(spots.hot, [[size.width / 2 + 20, size.height / 2 + 20, hotWeight.pin]]);
  assert.ok(spots.blocked.some((rect) => rect[0] === 700 && rect[2] === 316));
  assert.ok(spots.blocked.some((rect) => rect[0] === 300 && rect[2] === 440));
});

test("the viewer weighs the current cell at 50 and the undecided ones at 4, and skips decided ones", () => {
  const spots = viewerSpots({
    ...viewerInput,
    cells: [
      { object: "T1·C101", decided: false },
      { object: "T1·C112", decided: true },
      { object: "T1·C118", decided: false },
    ],
    currentCell: "T1·C101",
  });
  const weights = spots.hot.map((spot) => spot[2]);
  assert.deepEqual(
    weights.sort((a, b) => (a ?? 0) - (b ?? 0)),
    [hotWeight.cellToCheck, hotWeight.currentCell],
  );
});

test("a cells panel under the bottom right moves the viewer map to the bottom left", () => {
  const spots = viewerSpots({
    ...viewerInput,
    cellsPanel: [size.width - 300, size.height - 200, 280, 180],
  });
  const place = placeMinimap(size, { width: 208, height: 301 }, spots.hot, spots.blocked);
  assert.equal(place.corner, "bottom-left");
});
