import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDecodePool,
  DecodePoolDisposedError,
  defaultDecodeWorkers,
  type PoolPoint,
} from "../../src/index.ts";

interface Run {
  readonly slot: number;
  readonly job: string;
  resolve(result: object): void;
  reject(error: Error): void;
}

function fakeWorkers() {
  const runs: Run[] = [];
  const run = (slot: number, job: string) =>
    new Promise<object>((resolve, reject) => {
      runs.push({ slot, job, resolve, reject });
    });
  const finish = async (job: string, result: object = { job }) => {
    const found = runs.find((candidate) => candidate.job === job);
    assert.ok(found, `job ${job} never ran`);
    found.resolve(result);
    await settled();
  };
  return { runs, run, finish, started: () => runs.map(({ job }) => job) };
}

async function settled(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve();
}

const centre = (x: number, y = 0): PoolPoint => ({ x, y });

describe("the decode pool", () => {
  it("runs six jobs at once by default and queues the rest", async () => {
    const workers = fakeWorkers();
    const pool = createDecodePool<string, object>({ run: workers.run });
    for (let index = 0; index < 9; index++) {
      void pool.request(`tile-${index}`, `tile-${index}`, null);
    }
    await settled();
    assert.equal(defaultDecodeWorkers, 6);
    assert.equal(pool.size, 6);
    assert.equal(workers.runs.length, 6);
    assert.deepEqual(new Set(workers.runs.map(({ slot }) => slot)), new Set([0, 1, 2, 3, 4, 5]));
    assert.deepEqual(pool.stats(), {
      ...pool.stats(),
      queued: 3,
      active: 6,
      dispatched: 6,
    });
    await workers.finish("tile-0");
    assert.equal(workers.runs.length, 7);
    assert.equal(workers.runs[6]?.slot, workers.runs[0]?.slot);
  });

  it("takes the worker count as an option", async () => {
    const workers = fakeWorkers();
    const pool = createDecodePool<string, object>({ run: workers.run, size: 2 });
    for (const key of ["a", "b", "c"]) void pool.request(key, key, null);
    await settled();
    assert.equal(pool.size, 2);
    assert.deepEqual(workers.started(), ["a", "b"]);
    assert.throws(() => createDecodePool({ run: workers.run, size: 0 }), RangeError);
  });

  it("starts the queued job nearest the viewport centre first and follows the centre as it moves", async () => {
    const workers = fakeWorkers();
    const pool = createDecodePool<string, object>({ run: workers.run, size: 1 });
    void pool.request("busy", "busy", centre(0));
    void pool.request("far", "far", centre(9000));
    void pool.request("near", "near", centre(100));
    void pool.request("middle", "middle", centre(4000));
    void pool.request("other-side", "other-side", centre(-5000));
    pool.setFocus(centre(0));
    await workers.finish("busy");
    await workers.finish("near");
    pool.setFocus(centre(10_000));
    await workers.finish("middle");
    await workers.finish("far");
    assert.deepEqual(workers.started(), ["busy", "near", "middle", "far", "other-side"]);
  });

  it("keeps request order while no centre is known", async () => {
    const workers = fakeWorkers();
    const pool = createDecodePool<string, object>({ run: workers.run, size: 1 });
    for (const key of ["a", "b", "c"]) void pool.request(key, key, centre(key.charCodeAt(0)));
    await workers.finish("a");
    await workers.finish("b");
    assert.deepEqual(workers.started(), ["a", "b", "c"]);
  });

  it("drops a queued job whose caller aborted, without ever running it", async () => {
    const workers = fakeWorkers();
    const pool = createDecodePool<string, object>({ run: workers.run, size: 1 });
    void pool.request("busy", "busy", null);
    const controller = new AbortController();
    const queued = pool.request("gone", "gone", null, controller.signal);
    controller.abort();
    await assert.rejects(queued, { name: "AbortError" });
    await workers.finish("busy");
    assert.deepEqual(workers.started(), ["busy"]);
    assert.equal(pool.stats().cancelledQueued, 1);
    assert.equal(pool.idle(), true);
  });

  it("never cancels a job in flight and hands its late result to the next request for the same tile", async () => {
    const workers = fakeWorkers();
    const pool = createDecodePool<string, object>({ run: workers.run, size: 1 });
    const controller = new AbortController();
    const first = pool.request("tile", "tile", null, controller.signal);
    await settled();
    assert.deepEqual(workers.started(), ["tile"]);
    controller.abort();
    await assert.rejects(first, { name: "AbortError" });
    assert.equal(pool.idle(), false);
    const late = { pixels: "decoded once" };
    await workers.finish("tile", late);
    assert.equal(pool.idle(), true);
    const again = await pool.request("tile", "tile", null);
    assert.equal(again, late);
    assert.equal(workers.runs.length, 1);
    assert.deepEqual(
      {
        orphanedInFlight: pool.stats().orphanedInFlight,
        lateKept: pool.stats().lateKept,
        lateUsed: pool.stats().lateUsed,
        dispatched: pool.stats().dispatched,
      },
      { orphanedInFlight: 1, lateKept: 1, lateUsed: 1, dispatched: 1 },
    );
  });

  it("joins requests for the same tile and keeps the job while any caller still waits", async () => {
    const workers = fakeWorkers();
    const pool = createDecodePool<string, object>({ run: workers.run, size: 1 });
    void pool.request("busy", "busy", null);
    const leaving = new AbortController();
    const left = pool.request("tile", "tile", null, leaving.signal);
    const stays = pool.request("tile", "tile", null);
    leaving.abort();
    await assert.rejects(left, { name: "AbortError" });
    await workers.finish("busy");
    await workers.finish("tile", { shared: true });
    assert.deepEqual(await stays, { shared: true });
    assert.deepEqual(workers.started(), ["busy", "tile"]);
    assert.equal(pool.stats().joined, 1);
    assert.equal(pool.stats().cancelledQueued, 0);
    assert.equal(pool.stats().lateKept, 0);
  });

  it("forgets the oldest late results beyond its retain limit", async () => {
    const workers = fakeWorkers();
    const pool = createDecodePool<string, object>({ run: workers.run, size: 3, retain: 2 });
    const controller = new AbortController();
    for (const key of ["a", "b", "c"]) {
      pool.request(key, key, null, controller.signal).catch(() => undefined);
    }
    await settled();
    controller.abort();
    for (const key of ["a", "b", "c"]) await workers.finish(key);
    assert.equal(pool.stats().lateEvicted, 1);
    void pool.request("a", "a", null);
    await settled();
    assert.deepEqual(workers.started(), ["a", "b", "c", "a"]);
    assert.deepEqual(await pool.request("c", "c", null), { job: "c" });
  });

  it("rejects every caller of a failed job and keeps nothing from it", async () => {
    const workers = fakeWorkers();
    const pool = createDecodePool<string, object>({ run: workers.run, size: 1 });
    const one = pool.request("tile", "tile", null);
    const two = pool.request("tile", "tile", null);
    await settled();
    workers.runs[0]?.reject(new Error("corrupt tile"));
    await assert.rejects(one, /corrupt tile/);
    await assert.rejects(two, /corrupt tile/);
    void pool.request("tile", "tile", null);
    await settled();
    assert.equal(workers.runs.length, 2);
    assert.equal(pool.stats().failed, 1);
  });

  it("rejects waiting callers when disposed and refuses new work", async () => {
    const workers = fakeWorkers();
    const pool = createDecodePool<string, object>({ run: workers.run, size: 1 });
    const running = pool.request("a", "a", null);
    const queued = pool.request("b", "b", null);
    pool.dispose();
    await assert.rejects(running, DecodePoolDisposedError);
    await assert.rejects(queued, DecodePoolDisposedError);
    await assert.rejects(pool.request("c", "c", null), DecodePoolDisposedError);
  });
});
