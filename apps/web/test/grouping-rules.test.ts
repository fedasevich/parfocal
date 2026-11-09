import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  addRestoredShape,
  addShape,
  createDocument,
  type NewShape,
} from "../src/annotations/document.ts";
import {
  contains,
  groupByClass,
  groupByCluster,
  groupByContainment,
  groupByProvenance,
  groupShapes,
  type ShapeGroup,
} from "../src/annotations/grouping-rules.ts";
import type { Provenance, Shape } from "../src/annotations/shapes.ts";

type Input = NewShape & { provenance?: Provenance };

function build(inputs: Input[]): Shape[] {
  let doc = createDocument();
  const shapes: Shape[] = [];
  for (const input of inputs) {
    const { provenance, ...rest } = input;
    const change = provenance ? addRestoredShape(doc, rest, provenance, []) : addShape(doc, rest);
    doc = change.document;
    shapes.push(change.shape);
  }
  return shapes;
}

const rect = (x0: number, y0: number, x1: number, y1: number, extra: Partial<Input> = {}) =>
  ({ kind: "rectangle", points: Float32Array.of(x0, y0, x1, y1), ...extra }) as Input;
const dot = (x: number, y: number, extra: Partial<Input> = {}) =>
  ({ kind: "point", points: Float32Array.of(x, y), ...extra }) as Input;
const flat = (groups: readonly ShapeGroup[] | null) =>
  (groups ?? []).map((group) => [group.key, [...group.members]]);
const sizes = (groups: readonly ShapeGroup[] | null) =>
  (groups ?? []).map((group) => group.members.length);

describe("grouping by class", () => {
  test("an empty set has no groups", () => {
    assert.deepEqual(groupByClass([]), []);
  });

  test("groups by class key and keeps unclassed apart", () => {
    const shapes = build([
      rect(0, 0, 1, 1, { classKey: "a" }),
      rect(0, 0, 1, 1, { classKey: "b" }),
      rect(0, 0, 1, 1, { classKey: "a" }),
      rect(0, 0, 1, 1),
    ]);
    const [s0, s1, s2, s3] = shapes.map((shape) => shape.id);
    assert.deepEqual(flat(groupByClass(shapes)), [
      ["a", [s0, s2]],
      ["b", [s1]],
      ["none", [s3]],
    ]);
  });
});

describe("grouping by provenance", () => {
  test("an empty set has no groups", () => {
    assert.deepEqual(groupByProvenance([]), []);
  });

  test("separates human from each model and version", () => {
    const model = (version: string | null) => ({
      kind: "model" as const,
      model: "seg",
      version,
      runId: 1,
      piece: 0,
      confidence: null,
      edited: false,
    });
    const shapes = build([
      rect(0, 0, 1, 1),
      rect(0, 0, 1, 1, { provenance: model("1") }),
      rect(0, 0, 1, 1, { provenance: model("2") }),
      rect(0, 0, 1, 1, { provenance: model("1") }),
      rect(0, 0, 1, 1, { provenance: model(null) }),
    ]);
    assert.deepEqual(
      groupByProvenance(shapes).map((group) => [group.key, group.members.length]),
      [
        ["human", 1],
        ["model:seg@1", 2],
        ["model:seg@2", 1],
        ["model:seg", 1],
      ],
    );
  });
});

describe("grouping by cluster radius in microns", () => {
  const points = build([dot(0, 0), dot(100, 0), dot(1000, 0), dot(1090, 0)]);

  test("an empty set has no groups", () => {
    assert.deepEqual(groupByCluster([], 10, 0.5), []);
  });

  test("converts microns to pixels with the slide's microns per pixel", () => {
    assert.deepEqual(sizes(groupByCluster(points, 50, 0.5)), [2, 2]);
    assert.deepEqual(sizes(groupByCluster(points, 50, 1)), [1, 1, 1, 1]);
    assert.deepEqual(sizes(groupByCluster(points, 50, 0.25)), [2, 2]);
    const first = groupByCluster(points, 50, 0.5)?.[0];
    assert.deepEqual(first?.members, [points[0]?.id, points[1]?.id]);
  });

  test("a distance exactly on the radius joins", () => {
    assert.deepEqual(sizes(groupByCluster(points, 100, 1)), [2, 2]);
  });

  test("chains through intermediate shapes", () => {
    const chain = build([dot(0, 0), dot(90, 0), dot(180, 0)]);
    assert.deepEqual(sizes(groupByCluster(chain, 90, 1)), [3]);
  });

  test("zero radius groups only coincident shapes", () => {
    const pair = build([dot(5, 5), dot(5, 5), dot(6, 5)]);
    assert.deepEqual(sizes(groupByCluster(pair, 0, 1)), [2, 1]);
  });

  test("an unknown scale or a negative radius gives no answer", () => {
    assert.equal(groupByCluster(points, 50, null), null);
    assert.equal(groupByCluster(points, 50, undefined), null);
    assert.equal(groupByCluster(points, 50, 0), null);
    assert.equal(groupByCluster(points, -1, 0.5), null);
  });
});

describe("grouping by containment", () => {
  test("an empty set and a lone shape have no groups", () => {
    assert.deepEqual(groupByContainment([]), []);
    assert.deepEqual(groupByContainment(build([rect(0, 0, 10, 10)])), []);
  });

  test("nested shapes belong to their smallest container", () => {
    const [big, mid, small, far] = build([
      rect(0, 0, 100, 100),
      rect(10, 10, 50, 50),
      dot(20, 20),
      rect(200, 200, 210, 210),
    ]);
    assert.ok(big && mid && small && far);
    assert.deepEqual(flat(groupByContainment([big, mid, small, far])), [
      [`container:${big.id}`, [mid.id]],
      [`container:${mid.id}`, [small.id]],
    ]);
  });

  test("a shape touching the container boundary is contained", () => {
    const [outer, inner, corner] = build([rect(0, 0, 100, 100), rect(0, 0, 50, 50), dot(100, 100)]);
    assert.ok(outer && inner && corner);
    assert.equal(contains(outer, inner), true);
    assert.equal(contains(outer, corner), true);
  });

  test("a shape poking out is not contained", () => {
    const [outer, out, straddle] = build([
      rect(0, 0, 100, 100),
      rect(50, 50, 101, 90),
      rect(-10, 40, 40, 60),
    ]);
    assert.ok(outer && out && straddle);
    assert.equal(contains(outer, out), false);
    assert.equal(contains(outer, straddle), false);
  });

  test("a concave container does not contain a shape across its notch", () => {
    const [outer, across, inside] = build([
      {
        kind: "polygon",
        points: Float32Array.of(0, 0, 100, 0, 100, 100, 60, 100, 60, 40, 40, 40, 40, 100, 0, 100),
      },
      rect(30, 50, 70, 60),
      rect(5, 5, 20, 20),
    ]);
    assert.ok(outer && across && inside);
    assert.equal(contains(outer, across), false);
    assert.equal(contains(outer, inside), true);
  });

  test("open shapes contain nothing and identical shapes do not loop", () => {
    const [line, under, twinA, twinB] = build([
      { kind: "ruler", points: Float32Array.of(0, 0, 100, 100) },
      dot(50, 50),
      rect(0, 0, 10, 10),
      rect(0, 0, 10, 10),
    ]);
    assert.ok(line && under && twinA && twinB);
    assert.equal(contains(line, under), false);
    assert.deepEqual(flat(groupByContainment([twinA, twinB])), [
      [`container:${twinA.id}`, [twinB.id]],
    ]);
  });
});

describe("groupShapes", () => {
  test("dispatches by rule", () => {
    const shapes = build([rect(0, 0, 10, 10, { classKey: "a" }), dot(5, 5, { classKey: "a" })]);
    assert.equal(groupShapes(shapes, { by: "class" }, 0.5)?.length, 1);
    assert.equal(groupShapes(shapes, { by: "provenance" }, 0.5)?.length, 1);
    assert.equal(groupShapes(shapes, { by: "containment" }, 0.5)?.length, 1);
    assert.equal(groupShapes(shapes, { by: "cluster", radiusMicrons: 1 }, 0.5)?.length, 1);
    assert.equal(groupShapes(shapes, { by: "cluster", radiusMicrons: 1 }, null), null);
  });
});
