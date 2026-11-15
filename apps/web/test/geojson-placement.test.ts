import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isUnplaced,
  noPlacement,
  parseResults,
  placedText,
} from "../src/results/geojson-placement.ts";

const square = [
  [
    [100, 200],
    [300, 200],
    [300, 400],
    [100, 400],
    [100, 200],
  ],
];

type Collection = {
  features: { geometry: { coordinates: number[] | number[][][] }; properties: unknown }[];
};

const collection = JSON.stringify({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: square },
      properties: { classification: { name: "Tumor" } },
    },
    { type: "Feature", geometry: { type: "Point", coordinates: [10, 20] }, properties: {} },
  ],
});

test("a feature collection gives a ring and a point", () => {
  const parsed = parseResults(collection);
  assert.equal(parsed?.objects, 2);
  assert.equal(parsed?.shapes.length, 2);
  assert.equal(parsed?.shapes[0]?.kind, "ring");
  assert.equal(parsed?.shapes[1]?.kind, "point");
});

test("text that is not GeoJSON gives nothing", () => {
  assert.equal(parseResults("not json"), null);
  assert.equal(parseResults('{"hello":1}'), null);
});

test("placing scales about the origin and then shifts every coordinate", () => {
  const moved = JSON.parse(placedText(collection, { dx: 50, dy: -20, scale: 2 })) as Collection;
  assert.deepEqual(
    (moved.features[0]?.geometry.coordinates as number[][][] | undefined)?.[0]?.[0],
    [250, 380],
  );
  assert.deepEqual(moved.features[1]?.geometry.coordinates, [70, 20]);
  assert.deepEqual(moved.features[0]?.properties, { classification: { name: "Tumor" } });
});

test("no placement leaves the file as it was", () => {
  assert.equal(isUnplaced(noPlacement), true);
  assert.deepEqual(JSON.parse(placedText(collection, noPlacement)), JSON.parse(collection));
});
