import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Annotation } from "@parfocal/api-client";
import { polygonPointsOf, polygonToGeoJson } from "../src/annotations/geojson.ts";
import {
  clickDraft,
  closeDraft,
  closeEchoMs,
  type DraftStep,
  echoesClose,
  type Point,
  type PolygonDraft,
} from "../src/annotations/polygon-draft.ts";

const identity = (point: Point) => point;

function draftOf(step: DraftStep): PolygonDraft {
  assert.equal(step.kind, "draft");
  return step.kind === "draft" ? step.draft : [];
}

function clicks(points: readonly Point[]): DraftStep {
  let step: DraftStep = { kind: "draft", draft: [] };
  for (const point of points) step = clickDraft(draftOf(step), point, identity);
  return step;
}

const triangle = [
  { x: 10, y: 10 },
  { x: 110, y: 10 },
  { x: 60, y: 90 },
];

describe("drawing a polygon", () => {
  test("each click adds a vertex until the first vertex is clicked again", () => {
    const step = clicks([...triangle, { x: 12, y: 13 }]);
    assert.equal(step.kind, "closed");
    if (step.kind === "closed") assert.deepEqual([...step.points], [10, 10, 110, 10, 60, 90]);
  });

  test("a click near the first vertex does not close a polygon of two vertices", () => {
    const step = clicks([triangle[0] ?? { x: 0, y: 0 }, { x: 110, y: 10 }, { x: 14, y: 10 }]);
    assert.equal(draftOf(step).length, 3);
  });

  test("the second click of a double-click lands on the last vertex and adds nothing", () => {
    const step = clicks([...triangle, { x: 61, y: 91 }]);
    assert.equal(draftOf(step).length, 3);
  });

  test("closing needs three vertices", () => {
    assert.equal(closeDraft(triangle.slice(0, 2)).kind, "draft");
    assert.equal(closeDraft(triangle).kind, "closed");
  });

  test("the close distance is measured on screen, not on the slide", () => {
    const zoomedOut = (point: Point) => ({ x: point.x / 100, y: point.y / 100 });
    let draft: PolygonDraft = [];
    for (const point of [
      { x: 0, y: 0 },
      { x: 5000, y: 0 },
      { x: 0, y: 5000 },
    ]) {
      draft = draftOf(clickDraft(draft, point, zoomedOut));
    }
    assert.equal(clickDraft(draft, { x: 300, y: 300 }, zoomedOut).kind, "closed");
  });
});

function annotationWith(geometry: Record<string, unknown>): Annotation {
  return {
    id: "a-1",
    slide_id: "s-1",
    kind: "region",
    number: 1,
    code: "T+1",
    geometry,
    class_id: null,
    task_id: null,
    version: 1,
    created_by_user_id: null,
    created_at: "2026-11-04T00:00:00Z",
    updated_at: "2026-11-04T00:00:00Z",
    deleted_at: null,
  };
}

describe("polygon GeoJSON", () => {
  test("a drawn polygon goes out as a closed ring and comes back open", () => {
    const points = Float32Array.of(10, 10, 110, 10, 60, 90);
    const geometry = polygonToGeoJson(points);
    assert.deepEqual(geometry.coordinates, [
      [
        [10, 10],
        [110, 10],
        [60, 90],
        [10, 10],
      ],
    ]);
    const back = polygonPointsOf(annotationWith({ ...geometry }));
    assert.deepEqual(back === null ? null : [...back], [...points]);
  });

  test("shapes that are not a single-ring polygon are left out", () => {
    assert.equal(polygonPointsOf(annotationWith({ type: "Point", coordinates: [1, 2] })), null);
    assert.equal(
      polygonPointsOf(
        annotationWith({
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [0, 0],
            ],
          ],
        }),
      ),
      null,
    );
  });
});

describe("the second click of a double-click that closed a polygon", () => {
  const close = { x: 200, y: 150, time: 1000 };

  test("is swallowed when it lands within the close radius and the double-click interval", () => {
    assert.equal(echoesClose(close, { x: 203, y: 148, time: 1180 }), true);
  });

  test("is a fresh click once it lands farther away", () => {
    assert.equal(echoesClose(close, { x: 230, y: 150, time: 1100 }), false);
  });

  test("is a fresh click once the interval has passed", () => {
    assert.equal(echoesClose(close, { x: 200, y: 150, time: 1000 + closeEchoMs + 1 }), false);
  });

  test("never matches before any polygon was closed", () => {
    assert.equal(echoesClose(null, { x: 200, y: 150, time: 1001 }), false);
  });
});
