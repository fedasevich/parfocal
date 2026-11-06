import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  type CellSource,
  ChunkCache,
  decodePfc,
  PAGED_ABOVE,
  PagedCells,
  PfcError,
  readCellChunk,
  readCellSummary,
  rowOfNumber,
  UnknownPfcVersionError,
} from "../../src/index.ts";
import { encodePfc, gzipped, syntheticSlide } from "./synthetic.ts";

function fixture(name: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
}

interface Recorded extends CellSource {
  readonly requested: number[];
}

function recorded(
  chunk: (index: number) => Uint8Array<ArrayBuffer>,
  summary: Uint8Array<ArrayBuffer>,
): Recorded {
  const requested: number[] = [];
  return {
    requested,
    summary: () => Promise.resolve(summary),
    chunk: async (index) => {
      requested.push(index);
      await new Promise((resolve) => setImmediate(resolve));
      return chunk(index);
    },
  };
}

function fixtureSource(): Recorded {
  return recorded(
    (index) => fixture(`chunk-${String(index).padStart(5, "0")}.pfc`),
    fixture("summary.pfc"),
  );
}

describe("reading files written by the Python chunk store", () => {
  it("reads the summary columns and the chunk index", async () => {
    const summary = readCellSummary(await decodePfc(fixture("summary.pfc")));
    assert.equal(summary.count, 6);
    assert.equal(summary.classes, 3);
    assert.equal(summary.chunks.length, 3);
    assert.deepEqual([...summary.chunk], [0, 0, 1, 1, 2, 2]);
    assert.deepEqual([...(summary.number ?? [])], [1, 2, 3, 4, 5, 6]);
    assert.equal(summary.probs?.length, 18);
    assert.deepEqual(summary.chunks[1]?.tile, [2048, 0, 4096, 2048]);
    assert.equal(summary.chunks[2]?.vertices, 7);
    assert.equal(rowOfNumber(summary, 4), 3);
    assert.equal(rowOfNumber(summary, 99), -1);
  });

  it("reads a chunk's outlines, classes and flags", async () => {
    const chunk = readCellChunk(await decodePfc(fixture("chunk-00000.pfc")), 0);
    assert.equal(chunk.count, 2);
    assert.equal(chunk.vertices, 8);
    assert.deepEqual([...chunk.number], [1, 2]);
    assert.deepEqual([...chunk.classIndex], [0, 1]);
    assert.deepEqual([...chunk.points.subarray(0, 4)], [94, 94, 106, 94]);
    assert.deepEqual([...chunk.flags], [0, 1]);
    assert.equal(chunk.altClass?.[1], 0);
  });

  it("reads plain and gzip bytes and bytes that do not start on a boundary", async () => {
    const plain = encodePfc({ version: 1, kind: "cells", count: 0 }, [
      { name: "offsets", type: "u4", data: new Uint32Array([0]) },
    ]);
    const shifted = new Uint8Array(plain.length + 3);
    shifted.set(plain, 3);
    const viaPlain = await decodePfc(new Uint8Array(plain));
    const viaShifted = await decodePfc(shifted.subarray(3));
    const viaGzip = await decodePfc(gzipped(plain));
    for (const file of [viaPlain, viaShifted, viaGzip]) {
      assert.deepEqual([...(file.arrays.get("offsets") ?? [])], [0]);
    }
  });

  it("refuses a version it does not know, a wrong magic and a cut file", async () => {
    const future = encodePfc({ version: 2, kind: "cells", count: 0 }, []);
    await assert.rejects(decodePfc(new Uint8Array(future)), UnknownPfcVersionError);
    await assert.rejects(decodePfc(new Uint8Array(8)), PfcError);
    const whole = fixture("chunk-00000.pfc");
    const cut = gzipped(
      new Uint8Array(
        await new Response(
          new Blob([whole]).stream().pipeThrough(new DecompressionStream("gzip")),
        ).arrayBuffer(),
      ).subarray(0, 100),
    );
    await assert.rejects(decodePfc(cut), PfcError);
  });

  it("skips fields it does not know", async () => {
    const bytes = encodePfc({ version: 1, kind: "cells", count: 1 }, [
      { name: "from_the_future", type: "u2", data: new Uint16Array([5]) },
      { name: "offsets", type: "u4", data: new Uint32Array([0, 0]) },
    ]);
    const file = await decodePfc(new Uint8Array(bytes));
    assert.equal(file.arrays.get("offsets")?.length, 2);
  });
});

describe("ChunkCache", () => {
  async function chunks() {
    const loaded = [];
    for (const index of [0, 1, 2]) {
      loaded.push(
        readCellChunk(
          await decodePfc(fixture(`chunk-${String(index).padStart(5, "0")}.pfc`)),
          index,
        ),
      );
    }
    return loaded;
  }

  it("evicts the least recently used chunk outside the keep set once over the budget", async () => {
    const [a, b, c] = await chunks();
    assert.ok(a && b && c);
    const cache = new ChunkCache(16);
    cache.put(a);
    cache.put(b);
    cache.put(c);
    assert.equal(cache.vertices, 23);
    cache.touch(0);
    assert.equal(cache.evict(new Set([2])), 1);
    assert.equal(cache.has(1), false);
    assert.equal(cache.has(0) && cache.has(2), true);
    assert.equal(cache.vertices, 15);
  });

  it("never evicts a chunk that is in view even when the view alone is over budget", async () => {
    const [a, b] = await chunks();
    assert.ok(a && b);
    const cache = new ChunkCache(4);
    cache.put(a);
    cache.put(b);
    assert.equal(cache.evict(new Set([0, 1])), 0);
    assert.equal(cache.size, 2);
  });

  it("accounts bytes as chunks come and go", async () => {
    const [a, b] = await chunks();
    assert.ok(a && b);
    const cache = new ChunkCache(8);
    cache.put(a);
    cache.put(b);
    assert.equal(cache.bytes, a.byteLength + b.byteLength);
    cache.evict(new Set());
    assert.equal(cache.bytes, b.byteLength);
  });
});

describe("PagedCells", () => {
  it("pages above 200,000 cells and loads everything at or below", async () => {
    assert.equal(PAGED_ABOVE, 200_000);
    const source = fixtureSource();
    assert.equal((await PagedCells.open(source)).paged, false);
    assert.equal((await PagedCells.open(source, { pagedAbove: 6 })).paged, false);
    assert.equal((await PagedCells.open(source, { pagedAbove: 5 })).paged, true);
  });

  it("loads every chunk when the set is small, wherever the view is", async () => {
    const source = fixtureSource();
    const cells = await PagedCells.open(source);
    const report = await cells.show([0, 0, 10, 10]);
    assert.equal(report.loaded, 3);
    assert.equal(cells.stats().residentCells, 6);
  });

  it("fetches the view plus a quarter of margin, nearest chunk first", async () => {
    const source = fixtureSource();
    const cells = await PagedCells.open(source, { pagedAbove: 0, batch: 1 });
    await cells.show([1800, 1000, 2000, 1200]);
    assert.deepEqual(source.requested, [0, 1]);
    const far = fixtureSource();
    const other = await PagedCells.open(far, { pagedAbove: 0, batch: 1 });
    await other.show([100, 100, 200, 200]);
    assert.deepEqual(far.requested, [0]);
    await other.show([100, 1900, 200, 2100]);
    assert.deepEqual(far.requested, [0, 2]);
  });

  it("keeps deletions and promotions across eviction and a reload", async () => {
    const source = fixtureSource();
    const cells = await PagedCells.open(source, { pagedAbove: 0, vertexBudget: 8, batch: 1 });
    await cells.show([100, 100, 200, 200]);
    cells.edits.remove(2);
    cells.edits.promote(1, 2);
    await cells.show([2100, 100, 2200, 200]);
    await cells.show([100, 2100, 200, 2200]);
    assert.equal(cells.cache.has(0), false);
    const reloaded = await cells.cell(2);
    assert.equal(source.requested.filter((index) => index === 0).length, 2);
    assert.equal(reloaded?.removed, true);
    assert.equal((await cells.cell(1))?.classIndex, 2);
    await cells.show([100, 100, 200, 200]);
    const live: number[] = [];
    cells.forEachLive((chunk, local, classIndex) => {
      if (chunk.index === 0) live.push((chunk.number[local] ?? 0) * 10 + classIndex);
    });
    assert.deepEqual(live, [12]);
    assert.equal(cells.liveCount(), 5);
    assert.equal(cells.rowClass(0), 2);
    assert.equal(cells.rowIsLive(1), false);
    assert.equal(cells.edits.version, 2);
  });

  it("asks once for a chunk that two views both want", async () => {
    const source = fixtureSource();
    const cells = await PagedCells.open(source, { pagedAbove: 0 });
    await Promise.all([cells.show([100, 100, 200, 200]), cells.show([100, 100, 200, 200])]);
    assert.equal(source.requested.filter((index) => index === 0).length, 1);
  });

  it("stops an older view when a newer one arrives and evicts for the newer", async () => {
    const source = fixtureSource();
    const cells = await PagedCells.open(source, { pagedAbove: 0, batch: 1, vertexBudget: 8 });
    const first = cells.show([1800, 1000, 2000, 1200]);
    const second = cells.show([100, 1900, 200, 2100]);
    const [older, newer] = await Promise.all([first, second]);
    assert.equal(older.superseded, true);
    assert.equal(newer.superseded, false);
    assert.equal(cells.cache.has(2), true);
  });

  it("looks up one cell by number and answers null for a number it does not have", async () => {
    const cells = await PagedCells.open(fixtureSource(), { pagedAbove: 0 });
    const found = await cells.cell(3);
    assert.equal(found?.number, 3);
    assert.equal(found?.ring.length, 8);
    assert.equal(await cells.cell(40), null);
  });

  it("stays under the vertex budget plus the view while sweeping a large set", async () => {
    const slide = syntheticSlide({ cells: 60_000, verticesPerCell: 12 });
    const source = recorded((index) => slide.chunk(index), slide.summary);
    const budget = 120_000;
    const cells = await PagedCells.open(source, { pagedAbove: 10_000, vertexBudget: budget });
    assert.equal(cells.paged, true);
    const view = 600;
    let worst = 0;
    for (let step = 0; step < 12; step++) {
      const left = (slide.width - view * 2) * (step / 11);
      const top = ((slide.height - view * 2) * ((step * 5) % 12)) / 11;
      const report = await cells.show([left, top, left + view, top + view]);
      assert.equal(report.superseded, false);
      worst = Math.max(worst, cells.stats().residentVertices);
    }
    const inView = ((4 * 2048 * 2048) / (30 * 30)) * 12;
    assert.ok(worst <= budget + inView, `${worst} vertices resident`);
    assert.ok(cells.stats().residentChunks < slide.chunks);
  });
});
