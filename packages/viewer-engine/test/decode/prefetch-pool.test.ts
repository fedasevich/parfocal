import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDecodePool } from "../../src/index.ts";

interface Run {
  readonly slot: number;
  readonly job: string;
  readonly signal: undefined;
  resolve(result: object): void;
}

function fakeWorkers() {
  const runs: Run[] = [];
  const run = (slot: number, job: string) =>
    new Promise<object>((resolve) => {
      runs.push({ slot, job, signal: undefined, resolve });
    });
  const finish = async (job: string) => {
    const found = runs.find((candidate) => candidate.job === job);
    assert.ok(found, `job ${job} never ran`);
    found.resolve({ job });
    await settled();
  };
  return { runs, run, finish, started: () => runs.map(({ job }) => job) };
}

async function settled(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve();
}

describe("prefetch jobs in the decode pool", () => {
  it("run behind every visible request in the queue", async () => {
    const workers = fakeWorkers();
    const pool = createDecodePool<string, object>({ run: workers.run, size: 2 });
    void pool.request("busy-1", "busy-1", null);
    void pool.request("busy-2", "busy-2", null);
    pool.prefetch("ahead", "ahead", null);
    void pool.request("visible", "visible", null);
    await settled();
    await workers.finish("busy-1");
    assert.deepEqual(workers.started(), ["busy-1", "busy-2", "visible"]);
    await workers.finish("busy-2");
    assert.deepEqual(workers.started(), ["busy-1", "busy-2", "visible", "ahead"]);
  });

  it("use at most half of the workers at once", async () => {
    const workers = fakeWorkers();
    const pool = createDecodePool<string, object>({ run: workers.run, size: 4 });
    for (let index = 0; index < 6; index++) pool.prefetch(`p-${index}`, `p-${index}`, null);
    await settled();
    assert.equal(workers.runs.length, 2);
    void pool.request("visible", "visible", null);
    await settled();
    assert.equal(workers.started().includes("visible"), true);
  });

  it("are dropped from the queue, and a started one is never aborted", async () => {
    const workers = fakeWorkers();
    const pool = createDecodePool<string, object>({ run: workers.run, size: 2 });
    pool.prefetch("a", "a", null);
    pool.prefetch("b", "b", null);
    await settled();
    assert.deepEqual(workers.started(), ["a"]);
    const dropped = pool.dropPrefetch();
    assert.equal(dropped, 1);
    assert.equal(pool.prefetchStats().dropped, 1);
    assert.equal(pool.stats().queued, 0);
    assert.equal(pool.stats().active, 1);
    await workers.finish("a");
    assert.equal(pool.stats().orphanedInFlight, 0);
    assert.equal(pool.stats().failed, 0);
  });

  it("keep the queued ones the new prediction still wants", async () => {
    const workers = fakeWorkers();
    const pool = createDecodePool<string, object>({ run: workers.run, size: 2 });
    pool.prefetch("a", "a", null);
    pool.prefetch("b", "b", null);
    pool.prefetch("c", "c", null);
    await settled();
    assert.equal(pool.dropPrefetch(new Set(["c"])), 1);
    assert.equal(pool.prefetchStats().queued, 1);
  });

  it("serve the visible request that later asks for the same tile", async () => {
    const workers = fakeWorkers();
    const pool = createDecodePool<string, object>({ run: workers.run, size: 2 });
    pool.prefetch("tile", "tile", null);
    await settled();
    await workers.finish("tile");
    const result = await pool.request("tile", "tile", null);
    assert.deepEqual(result, { job: "tile" });
    assert.equal(workers.runs.length, 1);
    assert.equal(pool.prefetchStats().used, 1);
  });

  it("turn into a visible job when a visible request joins them", async () => {
    const workers = fakeWorkers();
    const pool = createDecodePool<string, object>({ run: workers.run, size: 1 });
    void pool.request("busy", "busy", null);
    pool.prefetch("early", "early", null);
    pool.prefetch("tile", "tile", null);
    const wanted = pool.request("tile", "tile", null);
    await settled();
    assert.equal(pool.dropPrefetch(), 1);
    await workers.finish("busy");
    assert.deepEqual(workers.started(), ["busy", "tile"]);
    await workers.finish("tile");
    assert.deepEqual(await wanted, { job: "tile" });
    assert.equal(pool.prefetchStats().joined, 1);
  });

  it("ignore a tile that is already queued, running or kept", () => {
    const workers = fakeWorkers();
    const pool = createDecodePool<string, object>({ run: workers.run, size: 2 });
    void pool.request("seen", "seen", null);
    assert.equal(pool.prefetch("seen", "seen", null), false);
    assert.equal(pool.prefetch("new", "new", null), true);
    assert.equal(pool.prefetch("new", "new", null), false);
  });
});
