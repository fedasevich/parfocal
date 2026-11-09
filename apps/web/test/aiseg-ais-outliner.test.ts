import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type AisWorker, createAisOutliner } from "../src/aiseg/ais-outliner.ts";
import type { AisReply, AisRequest } from "../src/aiseg/ais-worker.ts";

interface FakeWorker {
  readonly handle: AisWorker;
  readonly posted: AisRequest[];
  readonly terminated: () => boolean;
  readonly reply: (reply: AisReply) => void;
  readonly fail: (type: "error" | "messageerror") => void;
}

function fakeWorker(): FakeWorker {
  const posted: AisRequest[] = [];
  const messages: ((event: MessageEvent<AisReply>) => void)[] = [];
  const failures = new Map<string, ((event: Event) => void)[]>();
  let terminated = false;
  const handle = {
    postMessage(message: AisRequest) {
      posted.push(message);
    },
    addEventListener(type: string, listener: (event: never) => void) {
      if (type === "message") messages.push(listener as (event: MessageEvent<AisReply>) => void);
      else failures.set(type, [...(failures.get(type) ?? []), listener as (event: Event) => void]);
    },
    terminate() {
      terminated = true;
    },
  } as AisWorker;
  return {
    handle,
    posted,
    terminated: () => terminated,
    reply: (reply) => {
      for (const listener of messages) listener({ data: reply } as MessageEvent<AisReply>);
    },
    fail: (type) => {
      for (const listener of failures.get(type) ?? []) listener(new Event(type));
    },
  };
}

function spawner() {
  const workers: FakeWorker[] = [];
  const spawn = () => {
    const worker = fakeWorker();
    workers.push(worker);
    return worker.handle;
  };
  return { workers, spawn };
}

const maps = () => new Float32Array(4);

describe("the outline worker client", () => {
  it("answers a request with the worker's reply", async () => {
    const { workers, spawn } = spawner();
    const outliner = createAisOutliner(spawn);
    const answer = outliner.outline(maps(), 2, 2);
    workers[0]?.reply({ id: workers[0].posted[0]?.id ?? -1, instances: [] });
    assert.deepEqual(await answer, []);
    assert.equal(workers.length, 1);
  });

  it("rejects the waiting request when the worker stops and uses a fresh worker for the next", async () => {
    const { workers, spawn } = spawner();
    const outliner = createAisOutliner(spawn);
    const lost = outliner.outline(maps(), 2, 2);
    workers[0]?.fail("error");
    await assert.rejects(lost, /outline worker/);
    assert.equal(workers[0]?.terminated(), true);

    const next = outliner.outline(maps(), 2, 2);
    assert.equal(workers.length, 2);
    assert.equal(workers[0]?.posted.length, 1);
    workers[1]?.reply({ id: workers[1].posted[0]?.id ?? -1, instances: [] });
    assert.deepEqual(await next, []);
  });

  it("rejects the waiting request when a reply cannot be read", async () => {
    const { workers, spawn } = spawner();
    const outliner = createAisOutliner(spawn);
    const lost = outliner.outline(maps(), 2, 2);
    workers[0]?.fail("messageerror");
    await assert.rejects(lost, /outline worker/);
    assert.equal(workers[0]?.terminated(), true);
  });

  it("ignores a late failure of a worker it already replaced", async () => {
    const { workers, spawn } = spawner();
    const outliner = createAisOutliner(spawn);
    const lost = outliner.outline(maps(), 2, 2);
    workers[0]?.fail("error");
    await assert.rejects(lost);
    const next = outliner.outline(maps(), 2, 2);
    workers[0]?.fail("error");
    workers[1]?.reply({ id: workers[1].posted[0]?.id ?? -1, instances: [] });
    assert.deepEqual(await next, []);
    assert.equal(workers[1]?.terminated(), false);
  });

  it("does not spawn again for one worker that keeps stopping until a request is made", async () => {
    const { workers, spawn } = spawner();
    const outliner = createAisOutliner(spawn);
    const lost = outliner.outline(maps(), 2, 2);
    workers[0]?.fail("error");
    workers[0]?.fail("error");
    await assert.rejects(lost);
    assert.equal(workers.length, 1);
  });
});
