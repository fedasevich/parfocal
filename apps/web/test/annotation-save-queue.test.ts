import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  classifyStatus,
  createSaveQueue,
  type Outcome,
  type Remote,
  type Timers,
  type Transport,
} from "../src/annotations/save-queue.ts";

type Scheduled = { run: () => void; ms: number; live: boolean };

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function manualTimers() {
  const scheduled: Scheduled[] = [];
  const timers: Timers = {
    set: (run, ms) => {
      const entry = { run, ms, live: true };
      scheduled.push(entry);
      return entry;
    },
    clear: (handle) => {
      (handle as Scheduled).live = false;
    },
  };
  const fire = async () => {
    const entry = scheduled.find((item) => item.live);
    assert.ok(entry, "a timer is waiting");
    entry.live = false;
    entry.run();
    await settle();
  };
  return { timers, scheduled, fire };
}

function fakeServer() {
  const created: string[] = [];
  const removed: string[] = [];
  let down = false;
  let rejectNext = false;
  const transport: Transport<string> = {
    create: (body): Promise<Outcome<{ id: string; version: number }>> => {
      if (down) return Promise.reject(new TypeError("Failed to fetch"));
      if (rejectNext) {
        rejectNext = false;
        return Promise.resolve({ kind: "rejected" });
      }
      created.push(body);
      return Promise.resolve({ kind: "done", value: { id: `server-${body}`, version: 1 } });
    },
    remove: (id): Promise<Outcome<null>> => {
      if (down) return Promise.reject(new TypeError("Failed to fetch"));
      removed.push(id);
      return Promise.resolve({ kind: "done", value: null });
    },
  };
  return {
    transport,
    created,
    removed,
    setDown: (value: boolean) => {
      down = value;
    },
    rejectNext: () => {
      rejectNext = true;
    },
  };
}

const fresh = (): Remote => ({ id: null, version: 1 });

describe("save queue", () => {
  test("a burst of edits is sent together once the batch window ends", async () => {
    const server = fakeServer();
    const { timers, scheduled, fire } = manualTimers();
    const queue = createSaveQueue(server.transport, { timers });
    queue.enqueueCreate(fresh(), "a");
    queue.enqueueCreate(fresh(), "b");
    queue.enqueueCreate(fresh(), "c");
    assert.equal(scheduled.length, 1);
    assert.equal(queue.status().waiting, 3);
    await fire();
    assert.deepEqual(server.created, ["a", "b", "c"]);
    assert.equal(queue.status().phase, "saved");
    assert.equal(queue.status().waiting, 0);
  });

  test("edits made while the network is down are kept and sent in order after it returns", async () => {
    const server = fakeServer();
    const { timers, fire } = manualTimers();
    const queue = createSaveQueue(server.transport, { timers, retryMs: [1000, 2000] });
    server.setDown(true);
    queue.enqueueCreate(fresh(), "a");
    await fire();
    assert.equal(queue.status().phase, "retrying");
    queue.enqueueCreate(fresh(), "b");
    await fire();
    assert.equal(queue.status().phase, "retrying");
    assert.equal(queue.status().waiting, 2);
    assert.deepEqual(server.created, []);
    server.setDown(false);
    await fire();
    assert.deepEqual(server.created, ["a", "b"]);
    assert.equal(queue.status().phase, "saved");
    assert.equal(queue.status().waiting, 0);
  });

  test("retry waits grow and stop growing at the last step", async () => {
    const server = fakeServer();
    const { timers, scheduled, fire } = manualTimers();
    const queue = createSaveQueue(server.transport, { timers, retryMs: [10, 20] });
    server.setDown(true);
    queue.enqueueCreate(fresh(), "a");
    await fire();
    await fire();
    await fire();
    await fire();
    assert.deepEqual(
      scheduled.slice(1).map((item) => item.ms),
      [10, 20, 20, 20],
    );
  });

  test("flushing now skips the wait", async () => {
    const server = fakeServer();
    const { timers, fire } = manualTimers();
    const queue = createSaveQueue(server.transport, { timers });
    server.setDown(true);
    queue.enqueueCreate(fresh(), "a");
    await fire();
    server.setDown(false);
    queue.flushNow();
    await settle();
    assert.deepEqual(server.created, ["a"]);
    assert.equal(queue.status().phase, "saved");
  });

  test("removing a shape that was never sent cancels both and sends nothing", async () => {
    const server = fakeServer();
    const { timers } = manualTimers();
    const queue = createSaveQueue(server.transport, { timers });
    const remote = fresh();
    queue.enqueueCreate(remote, "a");
    queue.enqueueRemove(remote);
    assert.equal(queue.status().waiting, 0);
    assert.equal(queue.status().phase, "saved");
    queue.flushNow();
    await settle();
    assert.deepEqual(server.created, []);
    assert.deepEqual(server.removed, []);
  });

  test("removing a sent shape deletes it with the id the server gave", async () => {
    const server = fakeServer();
    const { timers, fire } = manualTimers();
    const queue = createSaveQueue(server.transport, { timers });
    const remote = fresh();
    queue.enqueueCreate(remote, "a");
    await fire();
    queue.enqueueRemove(remote);
    await fire();
    assert.deepEqual(server.removed, ["server-a"]);
  });

  test("a rejected edit is dropped, the rest still saves and the state says failed", async () => {
    const server = fakeServer();
    const { timers, fire } = manualTimers();
    const queue = createSaveQueue(server.transport, { timers });
    server.rejectNext();
    queue.enqueueCreate(fresh(), "bad");
    queue.enqueueCreate(fresh(), "good");
    await fire();
    assert.deepEqual(server.created, ["good"]);
    assert.equal(queue.status().phase, "failed");
    assert.equal(queue.status().waiting, 0);
  });

  test("listeners hear every change", async () => {
    const server = fakeServer();
    const { timers, fire } = manualTimers();
    const queue = createSaveQueue(server.transport, { timers });
    const seen: string[] = [];
    queue.subscribe(() => seen.push(queue.status().phase));
    queue.enqueueCreate(fresh(), "a");
    await fire();
    assert.equal(seen[0], "saving");
    assert.equal(seen[seen.length - 1], "saved");
  });
});

describe("status classes", () => {
  test("server trouble is retried and client mistakes are not", () => {
    assert.equal(classifyStatus(201), "done");
    assert.equal(classifyStatus(503), "retry");
    assert.equal(classifyStatus(429), "retry");
    assert.equal(classifyStatus(408), "retry");
    assert.equal(classifyStatus(422), "rejected");
    assert.equal(classifyStatus(409), "rejected");
  });
});
