import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createOverlayBuffers,
  instanceCapacity,
  smallestInstanceBuffer,
} from "../../src/custom-webgpu/overlay-buffers.ts";
import {
  atlasLayersFor,
  magnifiesFinestLevel,
  minAtlasLayers,
  parentTile,
  tileInstances,
  tileLevelFor,
  visibleTiles,
} from "../../src/custom-webgpu/tile-selection.ts";
import {
  buildVectorInstances,
  pointInstanceBytes,
  segmentInstanceBytes,
  triangleInstanceBytes,
} from "../../src/custom-webgpu/vector-instances.ts";
import { availableRendererRoutes, polygonBatchFromRings } from "../../src/index.ts";
import { pixelRendererRoutes, virtualLadder } from "../../src/viv/index.ts";

const ladder = virtualLadder(
  [
    { width: 4000, height: 3000, downsample: 1 },
    { width: 1000, height: 750, downsample: 4 },
  ] as never,
  256,
);

interface FakeBuffer {
  readonly size: number;
  destroyed: boolean;
  destroy(): void;
}

function fakeDevice() {
  const created: FakeBuffer[] = [];
  const writes: { buffer: FakeBuffer; offset: number; bytes: number }[] = [];
  return {
    created,
    writes,
    createBuffer: ({ size }: { size: number; usage: number }): FakeBuffer => {
      const buffer: FakeBuffer = {
        size,
        destroyed: false,
        destroy() {
          this.destroyed = true;
        },
      };
      created.push(buffer);
      return buffer;
    },
    queue: {
      writeBuffer: (buffer: FakeBuffer, offset: number, data: ArrayBuffer) => {
        writes.push({ buffer, offset, bytes: data.byteLength });
      },
    },
  };
}

describe("tile selection", () => {
  it("picks the level deck.gl picks for a flat view, the ceiling of the zoom", () => {
    assert.equal(tileLevelFor(0, 5), 0);
    assert.equal(tileLevelFor(2.5, 5), 0);
    assert.equal(tileLevelFor(-0.2, 5), 0);
    assert.equal(tileLevelFor(-1, 5), 1);
    assert.equal(tileLevelFor(-1.01, 5), 1);
    assert.equal(tileLevelFor(-2.9, 5), 2);
    assert.equal(tileLevelFor(-40, 5), 4);
  });

  it("samples the finest level nearest only when a texel covers a device pixel or more", () => {
    assert.equal(magnifiesFinestLevel(0, 0, 1), true);
    assert.equal(magnifiesFinestLevel(0, -0.5, 1), false);
    assert.equal(magnifiesFinestLevel(0, -0.5, 2), true);
    assert.equal(magnifiesFinestLevel(0, -1, 2), true);
    assert.equal(magnifiesFinestLevel(1, 3, 2), false);
  });

  it("lists only tiles inside the level, nearest to the centre first", () => {
    const tiles = visibleTiles({ x: 0, y: 0, zoom: 0 }, { width: 600, height: 400 }, ladder, 256);
    assert.deepEqual(tiles, [
      { level: 0, x: 0, y: 0 },
      { level: 0, x: 1, y: 0 },
    ]);
    const far = visibleTiles(
      { x: 2000, y: 1500, zoom: -5 },
      { width: 400, height: 300 },
      ladder,
      256,
    );
    assert.deepEqual(far, [{ level: ladder.length - 1, x: 0, y: 0 }]);
    assert.deepEqual(
      visibleTiles({ x: 90_000, y: 0, zoom: 0 }, { width: 400, height: 300 }, ladder, 256),
      [],
    );
  });

  it("walks to the parent tile until the coarsest level", () => {
    assert.deepEqual(parentTile({ level: 0, x: 5, y: 3 }, 3), { level: 1, x: 2, y: 1 });
    assert.equal(parentTile({ level: 2, x: 0, y: 0 }, 3), null);
  });

  it("sizes the atlas from the view and never past the device limit", () => {
    assert.equal(atlasLayersFor({ width: 400, height: 300 }, 256, 1024), 2 * 5 * 4 + 16);
    assert.equal(atlasLayersFor({ width: 10, height: 10 }, 256, 1024), minAtlasLayers);
    assert.equal(atlasLayersFor({ width: 4000, height: 3000 }, 256, 256), 256);
  });

  it("places a tile in clip space around the camera and keeps its valid texture part", () => {
    const [left, top, right, bottom, u, v, layer, alpha] = tileInstances(
      { x: 256, y: 128, zoom: 0 },
      { width: 512, height: 256 },
      ladder,
      256,
      [{ tile: { level: 0, x: 1, y: 0 }, layer: 7, width: 256, height: 128, alpha: 0.5 }],
    );
    assert.deepEqual([left, top, right, bottom], [0, 1, 1, -0]);
    assert.deepEqual([u, v, layer, alpha], [1, 0.5, 7, 0.5]);
  });
});

describe("vector instances", () => {
  const polygons = polygonBatchFromRings([
    {
      ring: [0, 0, 10, 0, 10, 10, 0, 10],
      holes: [[2, 2, 4, 2, 4, 4]],
      color: [255, 0, 0, 128],
    },
    { ring: [20, 0, 30, 0, 25, 10], color: [0, 255, 0, 255] },
  ]);

  it("packs fill triangles, ring segments and points of one set into one buffer", () => {
    const { data, counts } = buildVectorInstances({
      polygons,
      points: {
        count: 1,
        positions: new Float32Array([7, 8]),
        colors: new Uint8Array([9, 8, 7, 6]),
      },
    });
    assert.deepEqual(counts, {
      triangles: polygons.indices.length / 3,
      segments: 4 + 3 + 3,
      points: 1,
    });
    const segmentOffset = counts.triangles * triangleInstanceBytes;
    const pointOffset = segmentOffset + 10 * segmentInstanceBytes;
    assert.equal(data.byteLength, pointOffset + pointInstanceBytes);
    const lastOfOuter = new Float32Array(data, segmentOffset + 3 * segmentInstanceBytes, 5);
    assert.deepEqual([...lastOfOuter], [0, 10, 0, 0, 30]);
    const holeColor = new Uint8Array(data, segmentOffset + 4 * segmentInstanceBytes + 20, 4);
    assert.deepEqual([...holeColor], [255, 0, 0, 128]);
    const secondColor = new Uint8Array(data, segmentOffset + 7 * segmentInstanceBytes + 20, 4);
    assert.deepEqual([...secondColor], [0, 255, 0, 255]);
    assert.deepEqual([...new Float32Array(data, pointOffset, 2)], [7, 8]);
    assert.deepEqual([...new Uint8Array(data, pointOffset + 8, 4)], [9, 8, 7, 6]);
  });

  it("starts a dashed ring at the middle of its first edge, as the Viv route does", () => {
    const { data, counts } = buildVectorInstances(
      { polygons: polygonBatchFromRings([{ ring: [0, 0, 10, 0, 10, 10], color: [1, 2, 3, 4] }]) },
      { ringsFromMidFirstEdge: true },
    );
    assert.equal(counts.segments, 4);
    const offset = counts.triangles * triangleInstanceBytes;
    const segment = (index: number) => [
      ...new Float32Array(data, offset + index * segmentInstanceBytes, 5),
    ];
    assert.deepEqual(segment(0), [5, 0, 10, 0, 0]);
    assert.deepEqual(segment(1), [10, 0, 10, 10, 5]);
    assert.deepEqual(segment(3).slice(0, 4), [0, 0, 5, 0]);
  });

  it("leaves a path open and ends it with a zero length segment for the end cap", () => {
    const { data, counts } = buildVectorInstances({
      paths: {
        count: 1,
        positions: new Float32Array([0, 0, 5, 0, 5, 5]),
        starts: new Uint32Array([0, 3]),
        colors: new Uint8Array([1, 2, 3, 4]),
      },
    });
    assert.deepEqual(counts, { triangles: 0, segments: 3, points: 0 });
    assert.deepEqual([...new Float32Array(data, 2 * segmentInstanceBytes, 5)], [5, 5, 5, 5, 10]);
  });
});

describe("overlay buffers", () => {
  it("takes one buffer write for each update of an annotation set", () => {
    const device = fakeDevice();
    const buffers = createOverlayBuffers(device, 0);
    const first = buildVectorInstances({
      polygons: polygonBatchFromRings([{ ring: [0, 0, 10, 0, 10, 10], color: [1, 2, 3, 4] }]),
    });
    buffers.set("annotations", first.data, first.counts);
    assert.equal(device.writes.length, 1);
    assert.equal(device.created.length, 1);

    const second = buildVectorInstances({
      polygons: polygonBatchFromRings([
        { ring: [0, 0, 10, 0, 10, 10, 0, 10], color: [1, 2, 3, 4] },
        { ring: [20, 0, 30, 0, 25, 10], color: [5, 6, 7, 8] },
      ]),
    });
    buffers.set("annotations", second.data, second.counts);
    assert.equal(device.writes.length, 2);
    assert.equal(device.created.length, 1);
    assert.equal(device.writes[1]?.bytes, second.data.byteLength);
    assert.equal(buffers.writes(), 2);
    const stored = buffers.get("annotations");
    assert.equal(stored?.segments, 7);
    assert.equal(stored?.segmentOffset, second.counts.triangles * triangleInstanceBytes);
    assert.equal(
      stored?.pointOffset,
      second.counts.triangles * triangleInstanceBytes + 7 * segmentInstanceBytes,
    );
  });

  it("grows a buffer only when the set no longer fits and frees what it replaces", () => {
    const device = fakeDevice();
    const buffers = createOverlayBuffers(device, 0);
    const counts = { triangles: 0, segments: 0, points: 0 };
    buffers.set("nuclei", new ArrayBuffer(100), counts);
    buffers.set("nuclei", new ArrayBuffer(smallestInstanceBuffer + 4), counts);
    assert.deepEqual(
      device.created.map((buffer) => [buffer.size, buffer.destroyed]),
      [
        [smallestInstanceBuffer, true],
        [2 * smallestInstanceBuffer, false],
      ],
    );
    assert.equal(instanceCapacity(1), smallestInstanceBuffer);
    buffers.drop("nuclei");
    assert.equal(buffers.get("nuclei"), undefined);
    assert.equal(device.created[1]?.destroyed, true);
  });

  it("leaves out a set above the device buffer limit and never asks for a larger buffer", () => {
    const device = fakeDevice();
    const limit = 3 * smallestInstanceBuffer + 2;
    const buffers = createOverlayBuffers(device, 0, limit);
    const counts = { triangles: 0, segments: 0, points: 0 };
    assert.equal(
      buffers.set("nuclei", new ArrayBuffer(2 * smallestInstanceBuffer + 4), counts),
      true,
    );
    assert.equal(device.created[0]?.size, 3 * smallestInstanceBuffer);
    assert.equal(buffers.set("nuclei", new ArrayBuffer(limit + 2), counts), false);
    assert.equal(buffers.get("nuclei"), undefined);
    assert.equal(device.created.length, 1);
    assert.equal(device.created[0]?.destroyed, true);
    assert.equal(device.writes.length, 1);
    assert.equal(instanceCapacity(100, limit), smallestInstanceBuffer);
  });
});

describe("pixelRendererRoutes", () => {
  it("registers the custom WebGPU route beside Viv and the deck.gl WebGPU route", () => {
    assert.deepEqual(availableRendererRoutes(pixelRendererRoutes()), [
      "viv",
      "deck-webgpu",
      "custom-webgpu",
    ]);
  });
});
