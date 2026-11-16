import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SamEncoded } from "@parfocal/viewer-engine";
import { locatePatch } from "@parfocal/viewer-engine";
import type {
  PresetPatch,
  PresetPatchQuery,
  PresetPatchReader,
} from "../src/aiseg/patch-reader.ts";
import type { PresetPatchPlan } from "../src/aiseg/scale-presets.ts";
import {
  createServerEmbeddings,
  decodeFloat16,
  type EmbeddingSam,
  httpEmbeddingTransport,
  parseEmbeddingId,
  type ServerEmbeddingManifest,
  type ServerEmbeddingTransport,
  serverEmbeddingValues,
  withServerEmbeddings,
  withServerTiles,
} from "../src/aiseg/server-embeddings.ts";

const slideId = "6f1c0c1e-0000-4000-8000-000000000001";
const encoder = "pathosam-vit-b-histopathology-fp32";

function tileBits(columns: number, rows: number, cells: readonly [number, number][]): Uint8Array {
  const bits = new Uint8Array(Math.ceil((columns * rows) / 8));
  for (const [column, row] of cells) {
    const index = row * columns + column;
    bits[index >> 3] = (bits[index >> 3] ?? 0) | (1 << (index & 7));
  }
  return bits;
}

function manifest(overrides: Partial<ServerEmbeddingManifest> = {}): ServerEmbeddingManifest {
  return {
    encoder,
    dtype: "float16-le",
    dims: [1, 256, 64, 64],
    level: 0,
    downsample: 1,
    tile: 512,
    levelWidth: 1200,
    levelHeight: 1000,
    columns: 3,
    rows: 2,
    tiles: tileBits(3, 2, [
      [0, 0],
      [2, 1],
    ]),
    ...overrides,
  };
}

function recordedTile(value: number): ArrayBuffer {
  const bits = value === 0.5 ? 0x3800 : 0x3c00;
  const view = new DataView(new ArrayBuffer(serverEmbeddingValues * 2));
  for (let index = 0; index < serverEmbeddingValues; index++) view.setUint16(index * 2, bits, true);
  return view.buffer;
}

interface Recorder extends ServerEmbeddingTransport {
  manifests: number;
  tiles: [number, number][];
}

function transport(
  served: ServerEmbeddingManifest | null | Error,
  tile: ArrayBuffer | null | Error = recordedTile(0.5),
): Recorder {
  const recorder: Recorder = {
    manifests: 0,
    tiles: [],
    manifest() {
      recorder.manifests += 1;
      return served instanceof Error ? Promise.reject(served) : Promise.resolve(served);
    },
    tile(_slide, column, row) {
      recorder.tiles.push([column, row]);
      return tile instanceof Error ? Promise.reject(tile) : Promise.resolve(tile);
    },
  };
  return recorder;
}

interface FakeSam extends EmbeddingSam {
  encoded: string[];
  adopted: { id: string; first: number; length: number }[];
}

function fakeSam(adoptFails = false): FakeSam {
  const done = (id: string): SamEncoded => ({ id, ms: 1, evicted: [] });
  const sam: FakeSam = {
    encoded: [],
    adopted: [],
    encode(id) {
      sam.encoded.push(id);
      return Promise.resolve(done(id));
    },
    adopt(id, embedding) {
      if (adoptFails) return Promise.reject(new Error("worker gone"));
      sam.adopted.push({ id, first: embedding[0] ?? Number.NaN, length: embedding.length });
      return Promise.resolve(done(id));
    },
  };
  return sam;
}

const pixels = () => new Float32Array(3 * 1024 * 1024);
const tileId = (x: number, y: number, size = 512, level = 0) =>
  `${slideId}:${level}|${x}|${y}|${size}|${size}`;

describe("server embedding float16 decoding", () => {
  it("decodes little-endian half floats including the edge cases", () => {
    const view = new DataView(new ArrayBuffer(12));
    for (const [index, bits] of [0x3c00, 0xc000, 0x3800, 0x0001, 0x7c00, 0x0000].entries()) {
      view.setUint16(index * 2, bits, true);
    }
    const values = [...decodeFloat16(view.buffer)];
    assert.deepEqual(values.slice(0, 3), [1, -2, 0.5]);
    assert.equal(values[3], Math.fround(2 ** -24));
    assert.deepEqual(values.slice(4), [Infinity, 0]);
  });

  it("reads the slide and the patch window out of a smart select id", () => {
    assert.deepEqual(parseEmbeddingId(tileId(688, 488)), {
      slideId,
      window: { level: 0, x: 688, y: 488, width: 512, height: 512 },
    });
    assert.equal(parseEmbeddingId("region:3:7"), null);
  });
});

describe("the browser uses server embeddings when present", () => {
  it("adopts the server tile and never runs the local encoder", async () => {
    const served = transport(manifest());
    const sam = fakeSam();
    const wrapped = withServerEmbeddings(sam, createServerEmbeddings(served));
    await wrapped.encode(tileId(0, 0), pixels());
    await wrapped.encode(tileId(688, 488), pixels());
    assert.deepEqual(sam.encoded, []);
    assert.deepEqual(
      sam.adopted.map((entry) => [entry.id, entry.first, entry.length]),
      [
        [tileId(0, 0), 0.5, serverEmbeddingValues],
        [tileId(688, 488), 0.5, serverEmbeddingValues],
      ],
    );
    assert.deepEqual(served.tiles, [
      [0, 0],
      [2, 1],
    ]);
    assert.equal(served.manifests, 1);
  });
});

describe("the browser falls back to local encoding", () => {
  const cases: [string, Recorder, string, boolean?][] = [
    ["the slide has no server embeddings", transport(null), tileId(0, 0)],
    ["the manifest request fails", transport(new Error("offline")), tileId(0, 0)],
    ["the tile is outside the tissue", transport(manifest()), tileId(512, 0)],
    ["the tile request fails", transport(manifest(), new Error("offline")), tileId(0, 0)],
    ["the tile is not stored", transport(manifest(), null), tileId(0, 0)],
    ["the tile is short", transport(manifest(), new ArrayBuffer(100)), tileId(0, 0)],
    [
      "the encoder does not pair with the decoder",
      transport(manifest({ encoder: "vit-h" })),
      tileId(0, 0),
    ],
    ["the dtype is not float16", transport(manifest({ dtype: "int8" })), tileId(0, 0)],
    ["the patch is not on the server grid", transport(manifest()), tileId(100, 0)],
    ["the patch is at another level", transport(manifest()), tileId(0, 0, 512, 1)],
    ["the patch is another size", transport(manifest()), tileId(0, 0, 256)],
    ["the id names no patch window", transport(manifest()), "region:1:0"],
    ["the worker refuses the embedding", transport(manifest()), tileId(0, 0), true],
  ];
  for (const [name, served, id, adoptFails] of cases) {
    it(`when ${name}`, async () => {
      const sam = fakeSam(adoptFails === true);
      const wrapped = withServerEmbeddings(sam, createServerEmbeddings(served));
      await wrapped.encode(id, pixels());
      assert.deepEqual(sam.encoded, [id]);
      assert.deepEqual(sam.adopted, []);
    });
  }

  it("asks for the manifest again after a failed request", async () => {
    const served = transport(new Error("offline"));
    const server = createServerEmbeddings(served);
    await server.embedding(slideId, { level: 0, x: 0, y: 0, width: 512, height: 512 });
    await server.embedding(slideId, { level: 0, x: 0, y: 0, width: 512, height: 512 });
    assert.equal(served.manifests, 2);
  });
});

describe("patches snap to cached server tiles", () => {
  const level = { downsample: 1, width: 1200, height: 1000, tileWidth: 256, tileHeight: 256 };
  const at = (x: number, y: number) => ({ preset: "nuclei" as const, x, y });

  it("moves a click inside a cached tile so the patch is exactly that tile", async () => {
    const server = createServerEmbeddings(transport(manifest()));
    for (const [click, origin] of [
      [at(40, 300), { x: 0, y: 0 }],
      [at(1190, 990), { x: 688, y: 488 }],
    ] as const) {
      const snapped = await server.snap(slideId, 0, 512, click);
      const window = locatePatch(level, { level: 0, size: 512, x: snapped.x, y: snapped.y });
      assert.deepEqual({ x: window.x, y: window.y }, origin);
    }
  });

  it("reads the snapped patch through the preset reader", async () => {
    const queries: PresetPatchQuery[] = [];
    const plan = { level: 0, patchPixels: 512 } as PresetPatchPlan;
    const inner = {
      plan: () => Promise.resolve(plan),
      read: (query: PresetPatchQuery) => {
        queries.push(query);
        return Promise.resolve({} as PresetPatch);
      },
    } as unknown as PresetPatchReader;
    const reader = withServerTiles(inner, createServerEmbeddings(transport(manifest())), slideId);
    await reader.read(at(40, 300));
    await reader.read(at(600, 100));
    assert.deepEqual(queries, [at(256, 256), at(600, 100)]);
  });

  it("leaves the click alone where the server holds no tile or another scale", async () => {
    const server = createServerEmbeddings(transport(manifest()));
    assert.deepEqual(await server.snap(slideId, 0, 512, at(600, 100)), at(600, 100));
    assert.deepEqual(await server.snap(slideId, 1, 512, at(40, 300)), at(40, 300));
    assert.deepEqual(await server.snap(slideId, 0, 256, at(40, 300)), at(40, 300));
  });
});

describe("the http embedding transport", () => {
  it("reads the manifest and tile bytes and treats a refusal as missing", async () => {
    const asked: string[] = [];
    const bits = tileBits(3, 2, [[1, 1]]);
    const body = {
      slide_id: slideId,
      encoder,
      dtype: "float16-le",
      dims: [1, 256, 64, 64],
      level: 0,
      downsample: 1,
      tile: 512,
      level_width: 1200,
      level_height: 1000,
      columns: 3,
      rows: 2,
      tiles: btoa(String.fromCharCode(...bits)),
      tile_count: 1,
    };
    const fetcher = ((input: string) => {
      const url = input;
      asked.push(url);
      if (url.endsWith("/embeddings")) return Promise.resolve(Response.json(body));
      if (url.endsWith("/1/1")) return Promise.resolve(new Response(recordedTile(1)));
      return Promise.resolve(new Response(null, { status: 404 }));
    }) as typeof fetch;
    const http = httpEmbeddingTransport(fetcher);
    const read = await http.manifest(slideId);
    assert.deepEqual([...(read?.tiles ?? [])], [...bits]);
    assert.equal(read?.levelWidth, 1200);
    assert.equal((await http.tile(slideId, 1, 1))?.byteLength, serverEmbeddingValues * 2);
    assert.equal(await http.tile(slideId, 0, 0), null);
    assert.deepEqual(asked, [
      `/api/slides/${slideId}/embeddings`,
      `/api/slides/${slideId}/embeddings/1/1`,
      `/api/slides/${slideId}/embeddings/0/0`,
    ]);
  });
});
