import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createVectorOverlay,
  nearBlack,
  pointBatchFromPoints,
  polygonBatchFromRings,
  proposalDash,
  white,
} from "../../src/index.ts";
import { polygonOutlineData } from "../../src/overlay/deck/binary-data.ts";
import { createOverlayLayerBuilder } from "../../src/overlay/deck/overlay-layers.ts";

const red = [255, 0, 0, 255] as const;

const polygons = polygonBatchFromRings([{ ring: [0, 0, 10, 0, 10, 10, 0, 10], color: red }]);

const points = pointBatchFromPoints([{ x: 1, y: 1, color: red }]);

type Props = Record<string, unknown>;

function propsOf(layer: unknown): Props {
  return (layer as { props: Props }).props;
}

function attributeNames(layer: Props): string[] {
  return Object.keys((layer.data as { attributes: Props }).attributes);
}

function build(kind: "human-annotations" | "ai-proposals" | "nuclei", style = {}) {
  const overlay = createVectorOverlay({
    id: "a",
    kind,
    shapes: { polygons, points },
    style,
  });
  return createOverlayLayerBuilder()
    .build([overlay])
    .map((layer) => ({ id: layer.id, props: propsOf(layer) }));
}

function layer(layers: ReturnType<typeof build>, part: string): Props {
  const found = layers.find((candidate) => candidate.id === `overlay:a:${part}`);
  assert.ok(found, `no ${part} layer`);
  return found.props;
}

test("a class outline sits on a wider near-black casing that shares its vertices", () => {
  const layers = build("human-annotations");
  const casing = layer(layers, "outline-casings");
  const outline = layer(layers, "outlines");
  assert.equal(casing.getWidth, 4);
  assert.equal(outline.getWidth, 2);
  assert.deepEqual(casing.getColor, nearBlack);
  assert.deepEqual(attributeNames(outline), ["getPath", "getColor"]);
  assert.deepEqual(attributeNames(casing), ["getPath"]);
  const shared = (props: Props) =>
    (props.data as { attributes: { getPath: unknown } }).attributes.getPath;
  assert.equal(shared(casing), shared(outline));
  assert.deepEqual(outline.extensions, []);
});

test("the casing layers come before the lines so no casing covers a neighbouring line", () => {
  const order = build("human-annotations").map((entry) => entry.id.split(":")[2]);
  assert.deepEqual(order, ["fills", "outline-casings", "outlines", "points"]);
});

test("nuclei get a casing of half a pixel on each side", () => {
  const layers = build("nuclei");
  assert.equal(layer(layers, "outline-casings").getWidth, 2);
  assert.equal(layer(layers, "outlines").getWidth, 1);
});

test("an AI proposal is a near-black dashed line on a white casing, whatever its class colour", () => {
  const layers = build("ai-proposals");
  const casing = layer(layers, "outline-casings");
  const outline = layer(layers, "outlines");
  const dots = layer(layers, "points");
  assert.deepEqual(casing.getColor, white);
  assert.deepEqual(casing.extensions, []);
  assert.deepEqual(outline.getColor, nearBlack);
  assert.deepEqual(outline.getDashArray, proposalDash);
  assert.equal(outline.dashUnits, "pixels");
  assert.equal(outline.capRounded, false);
  assert.deepEqual(attributeNames(outline), ["getPath"]);
  assert.ok(attributeNames(layer(layers, "fills")).includes("getFillColor"));
  assert.deepEqual(dots.getFillColor, nearBlack);
  assert.deepEqual(dots.getLineColor, white);
});

test("a point gets a casing ring that adds to its radius", () => {
  const dots = layer(build("human-annotations"), "points");
  assert.equal(dots.stroked, true);
  assert.equal(dots.getRadius, 6);
  assert.equal(dots.getLineWidth, 1);
  assert.deepEqual(dots.getLineColor, nearBlack);
});

test("a style without a casing draws no casing layers and no point ring", () => {
  const layers = build("human-annotations", { casing: null });
  assert.deepEqual(
    layers.map((entry) => entry.id.split(":")[2]),
    ["fills", "outlines", "points"],
  );
  assert.equal(layer(layers, "points").stroked, false);
});

test("a casing that follows alpha takes each outline's alpha in its own colour", () => {
  const faint = polygonBatchFromRings([
    { ring: [0, 0, 10, 0, 10, 10, 0, 10], color: [255, 0, 0, 51] },
  ]);
  const builder = createOverlayLayerBuilder();
  const overlay = createVectorOverlay({
    id: "a",
    kind: "nuclei",
    shapes: { polygons: faint },
    style: { casing: { widthPx: 1, color: nearBlack, followsAlpha: true } },
  });
  const find = (built: unknown[]) =>
    propsOf(built.find((entry) => (entry as { id: string }).id === "overlay:a:outline-casings"));
  const casing = find(builder.build([overlay]));
  const colors = (casing.data as { attributes: { getColor: { value: Uint8Array } } }).attributes
    .getColor.value;
  assert.deepEqual(Array.from(colors.subarray(0, 4)), [11, 11, 11, 51]);
  assert.equal(find(builder.build([overlay])).data, casing.data);
});

test("an outline follows the outer ring and every hole as separate closed loops", () => {
  const batch = polygonBatchFromRings([
    {
      ring: [0, 0, 40, 0, 40, 40, 0, 40],
      holes: [[10, 10, 10, 30, 30, 30, 30, 10]],
      color: [1, 2, 3, 255],
    },
    { ring: [50, 0, 54, 0, 54, 4, 50, 4], color: [9, 8, 7, 255] },
  ]);
  const data = polygonOutlineData(batch);
  assert.equal(data.length, 3);
  assert.deepEqual([...(data.startIndices ?? [])], [0, 6, 12, 18]);
  const path = data.attributes.getPath;
  assert.ok(path && !(path instanceof Uint32Array));
  assert.deepEqual(
    [...path.value.subarray(12, 24)],
    [10, 10, 10, 30, 30, 30, 30, 10, 10, 10, 10, 30],
  );
  const colors = data.attributes.getColor;
  assert.ok(colors && !(colors instanceof Uint32Array));
  assert.deepEqual([...colors.value.subarray(6 * 4, 6 * 4 + 4)], [1, 2, 3, 255]);
  assert.deepEqual([...colors.value.subarray(12 * 4, 12 * 4 + 4)], [9, 8, 7, 255]);
});
