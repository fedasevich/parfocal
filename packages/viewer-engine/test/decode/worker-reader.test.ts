import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { DecodeReply, DecodeRequest } from "../../src/decode/protocol.ts";
import { type DecodeWorkerScope, startDecodeWorker } from "../../src/decode/worker-runtime.ts";
import {
  createDefaultPixelSourceRegistry,
  createRangeCache,
  openTiffSource,
  type SlideFormatId,
} from "../../src/index.ts";
import {
  createVivLevels,
  createWorkerRegionReader,
  type DecodeWorker,
  type VivLevels,
  type VivTile,
} from "../../src/viv/index.ts";
import { syntheticDir } from "../pixel-source/fixtures.ts";
import { serve } from "../pixel-source/serve.ts";
import { writeZarrFixture } from "../pixel-source/zarr-fixture.ts";

const served = await serve({ "/synthetic": syntheticDir });

after(async () => {
  await served.close();
});

function inProcessWorker(): DecodeWorker {
  const { port1, port2 } = new MessageChannel();
  startDecodeWorker(port2);
  port1.start();
  port2.start();
  return {
    postMessage: (message, transfer) => port1.postMessage(message, transfer),
    addEventListener: (type, listener) =>
      port1.addEventListener(type, listener as unknown as (event: Event) => void),
    terminate: () => port1.close(),
  };
}

const fixtures: readonly { file: string; formatId: SlideFormatId }[] = [
  { file: "synthetic-jpeg.tiff", formatId: "generic-tiff" },
  { file: "synthetic-zlib.ome.tiff", formatId: "ome-tiff" },
  { file: "synthetic-sparse.tiff", formatId: "generic-tiff" },
  { file: "synthetic-big-endian.tiff", formatId: "generic-tiff" },
];

async function everyTile(levels: VivLevels): Promise<VivTile[]> {
  const tiles: Promise<VivTile>[] = [];
  levels.levels.forEach((level) => {
    const [height = 0, width = 0] = level.shape;
    for (let y = 0; y * level.tileSize < height; y++) {
      for (let x = 0; x * level.tileSize < width; x++) tiles.push(level.getTile({ x, y }));
    }
  });
  return Promise.all(tiles);
}

function fixturePath(file: string): string {
  return `/synthetic/${file}`;
}

function readerFor(file: string, formatId: SlideFormatId, size?: number) {
  return createWorkerRegionReader({
    request: { formatId, url: served.url(fixturePath(file)) },
    spawn: inProcessWorker,
    ...(size === undefined ? {} : { size }),
  });
}

function fixtureRequests(file: string, from = 0) {
  return served.log.slice(from).filter((entry) => entry.path === fixturePath(file));
}

describe("the decode worker pool on real slides", () => {
  for (const { file, formatId } of fixtures) {
    it(`draws every tile of ${file} exactly as the main thread does`, async () => {
      const source = await openTiffSource({ formatId, url: served.url(fixturePath(file)) });
      const reader = readerFor(file, formatId);
      try {
        await reader.ready;
        const local = await everyTile(createVivLevels(source));
        const pooled = await everyTile(createVivLevels(source, { read: reader.read }));
        assert.equal(pooled.length, local.length);
        pooled.forEach((tile, index) => {
          const expected = local[index];
          assert.ok(expected);
          assert.equal(tile.width, expected.width);
          assert.equal(tile.height, expected.height);
          assert.deepEqual(tile.data, expected.data);
        });
        assert.equal(reader.stats().dispatched, pooled.length);
      } finally {
        reader.dispose();
        source.close();
      }
    });
  }

  it("draws a sparse OME-Zarr store exactly as the main thread does", async () => {
    const store = await writeZarrFixture({
      version: 2,
      dtype: "uint8",
      channels: 3,
      width: 300,
      height: 200,
      chunk: 128,
      levels: 2,
      missing: [[0, 0, 1]],
    });
    const zarr = await serve({ "/store": store.root });
    const request = { formatId: "ome-zarr", url: zarr.url("/store") } as const;
    const source = await createDefaultPixelSourceRegistry().open(request);
    const reader = createWorkerRegionReader({ request, spawn: inProcessWorker });
    try {
      await reader.ready;
      const local = await everyTile(createVivLevels(source));
      const pooled = await everyTile(createVivLevels(source, { read: reader.read }));
      assert.deepEqual(
        pooled.map(({ data }) => data),
        local.map(({ data }) => data),
      );
    } finally {
      reader.dispose();
      source.close();
      await zarr.close();
      await store.remove();
    }
  });

  it("uses a tile whose decode finished after its caller gave up, without fetching or decoding again", async () => {
    const file = "synthetic-jpeg.tiff";
    const source = await openTiffSource({
      formatId: "generic-tiff",
      url: served.url(fixturePath(file)),
    });
    const reader = readerFor(file, "generic-tiff", 1);
    try {
      await reader.ready;
      const levels = createVivLevels(source, { read: reader.read });
      const level = levels.levels[0];
      assert.ok(level);
      const controller = new AbortController();
      const abandoned = level.getTile({ x: 1, y: 1, signal: controller.signal });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(reader.stats().active, 1);
      controller.abort();
      await assert.rejects(abandoned);
      while (!reader.idle()) await new Promise((resolve) => setTimeout(resolve, 5));
      const before = served.log.length;
      const tile = await level.getTile({ x: 1, y: 1 });
      const fresh = await createVivLevels(source).levels[0]?.getTile({ x: 1, y: 1 });
      assert.deepEqual(tile.data, fresh?.data);
      assert.equal(fixtureRequests(file, before).length, 0);
      const stats = reader.stats();
      assert.equal(stats.dispatched, 1);
      assert.equal(stats.orphanedInFlight, 1);
      assert.equal(stats.lateKept, 1);
      assert.equal(stats.lateUsed, 1);
    } finally {
      reader.dispose();
      source.close();
    }
  });

  it("downloads each byte of the slide at most once across six workers", async () => {
    const file = "synthetic-zlib.ome.tiff";
    const source = await openTiffSource({
      formatId: "ome-tiff",
      url: served.url(fixturePath(file)),
    });
    const before = served.log.length;
    const reader = createWorkerRegionReader({
      request: { formatId: "ome-tiff", url: served.url(fixturePath(file)) },
      spawn: inProcessWorker,
      cache: createRangeCache({ blockSize: 4096 }),
    });
    try {
      await reader.ready;
      await everyTile(createVivLevels(source, { read: reader.read }));
      const ranges = fixtureRequests(file, before)
        .map(({ range }) => {
          const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? "");
          assert.ok(match, `unexpected request ${range}`);
          return [Number(match[1]), Number(match[2])] as const;
        })
        .sort((a, b) => a[0] - b[0]);
      assert.ok(ranges.length > 0);
      for (let index = 1; index < ranges.length; index++) {
        const previous = ranges[index - 1];
        const current = ranges[index];
        assert.ok(previous && current);
        assert.ok(current[0] > previous[1], `bytes ${current[0]} were fetched twice`);
      }
      assert.equal(reader.stats().network.fetches, ranges.length);
    } finally {
      reader.dispose();
      source.close();
    }
  });

  it("hands the decoded buffer to the page as a transfer, not a copy", async () => {
    const posted: { message: DecodeReply; transfer: Transferable[] }[] = [];
    let deliver: (message: DecodeRequest) => void = () => {};
    const scope: DecodeWorkerScope = {
      postMessage: (message, transfer) => posted.push({ message, transfer }),
      addEventListener: (_type, listener) => {
        deliver = (message) => listener(new MessageEvent("message", { data: message }));
      },
    };
    startDecodeWorker(scope);
    const { port1, port2 } = new MessageChannel();
    const cache = createRangeCache();
    port1.addEventListener("message", (event: MessageEvent) => {
      const request = event.data as { id: number; url: string; range: string | null };
      void cache.get(request.url, request.range).then((reply) => {
        port1.postMessage({ id: request.id, ...reply }, [reply.bytes.buffer]);
      });
    });
    port1.start();
    deliver({
      type: "open",
      request: { formatId: "generic-tiff", url: served.url(fixturePath("synthetic-jpeg.tiff")) },
      bytes: port2,
    });
    while (posted.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    deliver({
      type: "read",
      id: 7,
      region: { backing: 0, residual: 1, window: [0, 0, 64, 32], width: 64, height: 32 },
    });
    while (posted.length < 2) await new Promise((resolve) => setTimeout(resolve, 5));
    port1.close();
    const reply = posted[1];
    assert.ok(reply && reply.message.type === "tile");
    assert.equal(reply.message.id, 7);
    assert.equal(reply.message.data.byteLength, 64 * 32 * 3);
    assert.deepEqual(reply.transfer, [reply.message.data.buffer]);
  });
});
