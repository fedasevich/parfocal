import assert from "node:assert/strict";
import { test } from "node:test";
import { minimapBox } from "@parfocal/ui/lib/minimap-box";
import { pathPoints, placeMinimap } from "../src/screens/viewer-tools/minimap-placement.ts";
import { cropCentre } from "../src/screens/viewer-tools/tool-geometry.ts";
import {
  measuredSize,
  rulerEnds,
  toOverview,
  viewportOf,
} from "../src/screens/viewer-tools/tool-maths.ts";

const canvas = { width: 1048, height: 856 };
const box = { width: 208, height: 301 };

test("the minimap prefers the bottom right corner when nothing is under it", () => {
  assert.equal(placeMinimap(canvas, box, [], []).corner, "bottom-right");
});

test("the minimap leaves a corner where the reader is working", () => {
  const ruler: [number, number, number][] = [];
  for (let step = 0; step <= 1; step += 0.1)
    ruler.push([canvas.width - 330 + 235 * step, canvas.height - 190 + 60 * step, 200]);
  const place = placeMinimap(canvas, box, ruler, []);
  assert.notEqual(place.corner, "bottom-right");
  assert.equal(place.corner, "bottom-left");
});

test("a blocked corner is never picked while a free one is left", () => {
  const blocked: [number, number, number, number][] = [
    [canvas.width - 330, canvas.height - 170, 316, 156],
    [0, canvas.height - 320, 240, 320],
  ];
  const place = placeMinimap(canvas, box, [], blocked);
  assert.equal(place.corner, "top-right");
  assert.ok(
    place.ranked.every(
      (item, index, all) => index === 0 || item.score >= (all[index - 1]?.score ?? 0),
    ),
  );
});

test("the minimap's sizes follow the mock: full, travel, compact and a 92 px locator", () => {
  const wide: [number, number, number, number] = [0, 0, 1600, 1000];
  const tall: [number, number, number, number] = [0, 0, 1400, 1924];
  assert.equal(minimapBox("full", wide).mapWidth, 196);
  assert.equal(minimapBox("travel", wide).mapWidth, 250);
  assert.equal(minimapBox("compact", wide).mapWidth, 150);
  assert.equal(minimapBox("pip", tall).mapHeight, 92);
  assert.equal(minimapBox("full", tall).mapHeight, 245);
});

test("the 10x and 40x stills map their centre onto the crop centre of the overview", () => {
  assert.deepEqual(toOverview("mid", [800, 500]), cropCentre.mid);
  assert.deepEqual(toOverview("hpf", [800, 500]), cropCentre.hpf);
  const view = viewportOf("mid", { x: 800, y: 500, scale: 1 }, { width: 1600, height: 1000 });
  assert.ok(view[2] > 100 && view[2] < 120);
});

test("the ruler crosses T1 along its longer side and reads 8.00 mm", () => {
  const [from, to] = rulerEnds("T1");
  assert.equal(from[0], to[0]);
  assert.equal(measuredSize(7.7), 8);
});

test("path points read the mock's M and L path", () => {
  assert.deepEqual(pathPoints("M1,2L3,4L5,6"), [
    [1, 2],
    [3, 4],
    [5, 6],
  ]);
});
