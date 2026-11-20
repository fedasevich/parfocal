import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createRangeCache, openTiffSource, type PixelSource } from "../../src/index.ts";

const roundTripMs = 40;
const blockSize = 4096;
const tileSize = 16;
const columns = 20;
const rows = 20;
const url = "https://slides.example/many-tiles.tiff";

function manyTileTiff(): Uint8Array {
  const tiles = columns * rows;
  const tileBytes = tileSize * tileSize;
  const entries = 11;
  const ifdBytes = 2 + entries * 12 + 4;
  const countsAt = 8 + ifdBytes;
  const dataAt = countsAt + tiles * 4;
  const offsetsAt = dataAt + tiles * tileBytes;
  const file = new Uint8Array(offsetsAt + tiles * 4);
  const view = new DataView(file.buffer);
  view.setUint16(0, 0x4949, true);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, entries, true);
  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    const base = 10 + at * 12;
    view.setUint16(base, tag, true);
    view.setUint16(base + 2, type, true);
    view.setUint32(base + 4, count, true);
    if (type === 3) view.setUint16(base + 8, value, true);
    else view.setUint32(base + 8, value, true);
  };
  entry(0, 256, 3, 1, columns * tileSize);
  entry(1, 257, 3, 1, rows * tileSize);
  entry(2, 258, 3, 1, 8);
  entry(3, 259, 3, 1, 1);
  entry(4, 262, 3, 1, 1);
  entry(5, 277, 3, 1, 1);
  entry(6, 322, 3, 1, tileSize);
  entry(7, 323, 3, 1, tileSize);
  entry(8, 324, 4, tiles, offsetsAt);
  entry(9, 325, 4, tiles, countsAt);
  entry(10, 284, 3, 1, 1);
  for (let tile = 0; tile < tiles; tile++) {
    view.setUint32(countsAt + tile * 4, tileBytes, true);
    view.setUint32(offsetsAt + tile * 4, dataAt + tile * tileBytes, true);
    file.fill(tile % 251, dataAt + tile * tileBytes, dataAt + (tile + 1) * tileBytes);
  }
  return file;
}

interface Call {
  readonly range: string | null;
  readonly start: number;
  readonly end: number;
}

async function openRecorded() {
  const file = manyTileTiff();
  const calls: Call[] = [];
  const t0 = performance.now();
  const fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const range = new Headers(init?.headers).get("range");
    const start = performance.now() - t0;
    await sleep(roundTripMs);
    calls.push({ range, start, end: performance.now() - t0 });
    const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? "");
    const from = match ? Number(match[1]) : 0;
    const to = match ? Math.min(Number(match[2]) + 1, file.length) : file.length;
    if (from >= file.length) {
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${file.length}` },
      });
    }
    return new Response(file.slice(from, to), {
      status: 206,
      headers: { "content-range": `bytes ${from}-${to - 1}/${file.length}` },
    });
  };
  const cache = createRangeCache({ blockSize, fetch });
  const source = await openTiffSource({
    formatId: "generic-tiff",
    url,
    fetch: (_input, init) =>
      cache.get(url, new Headers(init?.headers).get("range")).then(
        (reply) =>
          new Response(reply.bytes.slice(), {
            status: reply.status,
            headers: reply.contentRange === null ? {} : { "content-range": reply.contentRange },
          }),
      ),
  });
  return { source, calls, t0 };
}

async function readTile(source: PixelSource, column: number, row: number) {
  await source.getRaster({
    level: 0,
    window: [column * tileSize, row * tileSize, (column + 1) * tileSize, (row + 1) * tileSize],
  });
}

const overlapping = (calls: readonly Call[]) =>
  calls.some((call, at) => calls.slice(at + 1).some((other) => other.start < call.end));

describe("the byte requests of one tile", () => {
  it("start with the slide's tile offsets loaded together, so a tile waits for one round trip", async () => {
    const { source, calls, t0 } = await openRecorded();
    try {
      await sleep(roundTripMs * 3);
      const opened = calls.length;
      const started = performance.now() - t0;
      await readTile(source, 3, 4);
      const waited = performance.now() - t0 - started;
      const made = calls.slice(opened);
      assert.equal(made.length, 1);
      assert.ok(waited < roundTripMs * 1.8, `waited ${waited} ms`);
    } finally {
      source.close();
    }
  });

  it("make one offsets request for the slide even when tiles are read straight after opening", async () => {
    const { source, calls } = await openRecorded();
    try {
      const opened = calls.length;
      await Promise.all([
        readTile(source, 1, 1),
        readTile(source, 18, 18),
        readTile(source, 9, 12),
      ]);
      const made = calls.slice(opened);
      assert.equal(calls.filter((call) => (call.range ?? "").startsWith("bytes=102400")).length, 1);
      assert.ok(made.length <= 4, `${made.length} requests`);
    } finally {
      source.close();
    }
  });

  it("asks for each tile's bytes without another lookup in front once the offsets are held", async () => {
    const { source, calls } = await openRecorded();
    try {
      await sleep(roundTripMs * 3);
      const opened = calls.length;
      await Promise.all([readTile(source, 4, 2), readTile(source, 10, 8), readTile(source, 2, 15)]);
      const made = calls.slice(opened);
      assert.equal(made.length, 3);
      assert.equal(overlapping(made), true);
      const last = Math.max(...made.map((call) => call.end));
      const first = Math.min(...made.map((call) => call.start));
      assert.ok(last - first < roundTripMs * 1.8);
    } finally {
      source.close();
    }
  });
});
