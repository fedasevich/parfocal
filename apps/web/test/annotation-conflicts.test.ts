import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { adoptTheirs, sketchOf, theirsFromCurrent } from "../src/annotations/conflicts.ts";
import { addShape, createDocument } from "../src/annotations/document.ts";
import {
  createSaveQueue,
  type Outcome,
  type Remote,
  type Theirs,
  type Timers,
  type Transport,
} from "../src/annotations/save-queue.ts";

type Scheduled = { run: () => void; live: boolean };

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function manualTimers() {
  const scheduled: Scheduled[] = [];
  const timers: Timers = {
    set: (run) => {
      const entry = { run, live: true };
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
  return { timers, fire };
}

const polygon = (...ring: [number, number][]) => ({
  type: "Polygon",
  coordinates: [[...ring, ring[0] ?? [0, 0]]],
});

const colleague = (overrides: Partial<Theirs> = {}): Theirs => ({
  version: 5,
  deleted: false,
  geometry: polygon([0, 0], [10, 0], [10, 10]),
  classId: null,
  changedBy: "u-2",
  ...overrides,
});

function contested(theirs: Theirs) {
  const sent: string[] = [];
  let stale = true;
  const transport: Transport<string> = {
    create: (body): Promise<Outcome<{ id: string; version: number }>> => {
      sent.push(`create:${body}`);
      return Promise.resolve({ kind: "done", value: { id: `id-${body}`, version: 1 } });
    },
    update: (id, version, body): Promise<Outcome<{ version: number }>> => {
      sent.push(`update:${id}@${version}:${body}`);
      if (stale && version !== theirs.version) {
        return Promise.resolve({ kind: "conflict", theirs });
      }
      return Promise.resolve({ kind: "done", value: { version: version + 1 } });
    },
    remove: (id, version): Promise<Outcome<null>> => {
      sent.push(`remove:${id}@${version}`);
      if (stale && version !== theirs.version) {
        return Promise.resolve({ kind: "conflict", theirs });
      }
      return Promise.resolve({ kind: "done", value: null });
    },
  };
  return {
    transport,
    sent,
    unstale: () => {
      stale = false;
    },
  };
}

const saved = (): Remote => ({ id: "s1", version: 2 });

describe("version checks on save", () => {
  test("an edit of a saved shape is sent with the version the client holds, then the new version is held", async () => {
    const server = contested(colleague({ version: 2 }));
    const { timers, fire } = manualTimers();
    const queue = createSaveQueue(server.transport, { timers });
    const remote = saved();
    queue.enqueueUpdate(remote, "moved");
    await fire();
    assert.deepEqual(server.sent, ["update:s1@2:moved"]);
    assert.equal(remote.version, 3);
    assert.equal(queue.status().phase, "saved");
  });

  test("edits to one shape that wait together are sent once with the last body", async () => {
    const server = contested(colleague({ version: 2 }));
    const { timers, fire } = manualTimers();
    const queue = createSaveQueue(server.transport, { timers });
    const remote = saved();
    queue.enqueueUpdate(remote, "first");
    queue.enqueueUpdate(remote, "second");
    assert.equal(queue.status().waiting, 1);
    await fire();
    assert.deepEqual(server.sent, ["update:s1@2:second"]);
  });

  test("an edit of a shape still waiting to be created changes the creation instead", async () => {
    const server = contested(colleague());
    const { timers, fire } = manualTimers();
    const queue = createSaveQueue(server.transport, { timers });
    const remote: Remote = { id: null, version: 1 };
    queue.enqueueCreate(remote, "drawn");
    queue.enqueueUpdate(remote, "drawn-then-moved");
    await fire();
    assert.deepEqual(server.sent, ["create:drawn-then-moved"]);
  });

  test("deleting a shape drops its waiting edits", async () => {
    const server = contested(colleague({ version: 2 }));
    const { timers, fire } = manualTimers();
    const queue = createSaveQueue(server.transport, { timers });
    const remote = saved();
    queue.enqueueUpdate(remote, "moved");
    queue.enqueueRemove(remote);
    await fire();
    assert.deepEqual(server.sent, ["remove:s1@2"]);
  });
});

describe("a stale save", () => {
  test("is not retried, is kept with the colleague's version and the queue reports a conflict", async () => {
    const theirs = colleague();
    const server = contested(theirs);
    const { timers, fire } = manualTimers();
    const queue = createSaveQueue(server.transport, { timers });
    queue.enqueueUpdate(saved(), "mine");
    await fire();
    assert.deepEqual(server.sent, ["update:s1@2:mine"]);
    assert.equal(queue.status().phase, "conflict");
    assert.equal(queue.status().conflicts, 1);
    assert.equal(queue.status().waiting, 0);
    const [conflict] = queue.conflicts();
    assert.equal(conflict?.action, "update");
    assert.equal(conflict?.mine, "mine");
    assert.equal(conflict?.theirs, theirs);
  });

  test("other edits still save while one shape waits on a conflict", async () => {
    const server = contested(colleague());
    const { timers, fire } = manualTimers();
    const queue = createSaveQueue(server.transport, { timers });
    queue.enqueueUpdate(saved(), "mine");
    queue.enqueueCreate({ id: null, version: 1 }, "new");
    await fire();
    assert.deepEqual(server.sent, ["update:s1@2:mine", "create:new"]);
    assert.equal(queue.status().phase, "conflict");
  });

  test("keep mine sends the edit again against the colleague's version", async () => {
    const server = contested(colleague());
    const { timers, fire } = manualTimers();
    const queue = createSaveQueue(server.transport, { timers });
    const remote = saved();
    queue.enqueueUpdate(remote, "mine");
    await fire();
    const [conflict] = queue.conflicts();
    assert.ok(conflict);
    queue.resolve(conflict, "mine");
    assert.equal(queue.conflicts().length, 0);
    await fire();
    assert.deepEqual(server.sent, ["update:s1@2:mine", "update:s1@5:mine"]);
    assert.equal(remote.version, 6);
    assert.equal(queue.status().phase, "saved");
    assert.equal(queue.status().conflicts, 0);
  });

  test("keep theirs sends nothing and holds the colleague's version", async () => {
    const server = contested(colleague());
    const { timers, fire } = manualTimers();
    const queue = createSaveQueue(server.transport, { timers });
    const remote = saved();
    queue.enqueueUpdate(remote, "mine");
    await fire();
    const [conflict] = queue.conflicts();
    assert.ok(conflict);
    queue.resolve(conflict, "theirs");
    assert.deepEqual(server.sent, ["update:s1@2:mine"]);
    assert.equal(remote.version, 5);
    assert.equal(queue.status().phase, "saved");
    assert.equal(queue.status().conflicts, 0);
  });

  test("a later edit of the contested shape replaces the kept edit", async () => {
    const server = contested(colleague());
    const { timers, fire } = manualTimers();
    const queue = createSaveQueue(server.transport, { timers });
    const remote = saved();
    queue.enqueueUpdate(remote, "mine");
    await fire();
    queue.enqueueUpdate(remote, "mine-again");
    assert.equal(queue.status().waiting, 0);
    const [conflict] = queue.conflicts();
    assert.ok(conflict);
    queue.resolve(conflict, "mine");
    await fire();
    assert.deepEqual(server.sent.at(-1), "update:s1@5:mine-again");
  });

  test("keep mine against a shape the colleague deleted creates it again", async () => {
    const server = contested(colleague({ deleted: true, version: 3 }));
    const { timers, fire } = manualTimers();
    const queue = createSaveQueue(server.transport, { timers });
    const remote = saved();
    queue.enqueueUpdate(remote, "mine");
    await fire();
    const [conflict] = queue.conflicts();
    assert.ok(conflict);
    queue.resolve(conflict, "mine");
    await fire();
    assert.deepEqual(server.sent.at(-1), "create:mine");
    assert.equal(remote.id, "id-mine");
    assert.equal(queue.status().phase, "saved");
  });

  test("a delete that meets a colleague's edit can be sent again or dropped", async () => {
    const server = contested(colleague());
    const { timers, fire } = manualTimers();
    const queue = createSaveQueue(server.transport, { timers });
    const kept = saved();
    const dropped = { id: "s2", version: 2 };
    queue.enqueueRemove(kept);
    queue.enqueueRemove(dropped);
    await fire();
    assert.equal(queue.conflicts().length, 2);
    const [first, second] = queue.conflicts();
    assert.ok(first && second);
    assert.equal(first.action, "remove");
    queue.resolve(first, "mine");
    queue.resolve(second, "theirs");
    await fire();
    assert.deepEqual(server.sent, ["remove:s1@2", "remove:s2@2", "remove:s1@5"]);
    assert.equal(dropped.version, 5);
    assert.equal(queue.status().phase, "saved");
  });

  test("a delete that meets a colleague's delete needs no choice to be sent again", async () => {
    const server = contested(colleague({ deleted: true }));
    const { timers, fire } = manualTimers();
    const queue = createSaveQueue(server.transport, { timers });
    queue.enqueueRemove(saved());
    await fire();
    const [conflict] = queue.conflicts();
    assert.ok(conflict);
    queue.resolve(conflict, "mine");
    assert.deepEqual(server.sent, ["remove:s1@2"]);
    assert.equal(queue.status().phase, "saved");
  });
});

describe("reading the colleague's version", () => {
  test("the current object of a conflict answer becomes their version", () => {
    const theirs = theirsFromCurrent({
      version: 4,
      geometry: polygon([0, 0], [4, 0], [4, 4]),
      class_id: "c-1",
      deleted_at: null,
      changed_by_user_id: "u-9",
    });
    assert.deepEqual(theirs?.version, 4);
    assert.equal(theirs?.deleted, false);
    assert.equal(theirs?.classId, "c-1");
    assert.equal(theirs?.changedBy, "u-9");
  });

  test("a deleted object is marked deleted and a broken answer is refused", () => {
    const gone = theirsFromCurrent({
      version: 6,
      geometry: polygon([0, 0], [4, 0], [4, 4]),
      deleted_at: "2026-11-05T10:00:00Z",
    });
    assert.equal(gone?.deleted, true);
    assert.equal(theirsFromCurrent({ geometry: {} }), null);
    assert.equal(theirsFromCurrent(null), null);
  });

  test("keep theirs reshapes the local polygon to the colleague's outline", () => {
    const first = addShape(createDocument(), {
      kind: "polygon",
      points: Float32Array.from([0, 0, 5, 0, 5, 5]),
    });
    const adopted = adoptTheirs(first.document, first.shape.id, colleague());
    assert.equal(adopted.shapeId, first.shape.id);
    const shape = adopted.document.shapes.get(first.shape.id);
    assert.deepEqual([...(shape?.points ?? [])], [0, 0, 10, 0, 10, 10]);
  });

  test("keep theirs removes the local shape when the colleague deleted it", () => {
    const first = addShape(createDocument(), {
      kind: "polygon",
      points: Float32Array.from([0, 0, 5, 0, 5, 5]),
    });
    const adopted = adoptTheirs(first.document, first.shape.id, colleague({ deleted: true }));
    assert.equal(adopted.shapeId, null);
    assert.equal(adopted.document.shapes.size, 0);
  });

  test("keep theirs brings back a shape the expert deleted and the colleague changed", () => {
    const adopted = adoptTheirs(createDocument(), null, colleague());
    assert.equal(adopted.document.shapes.size, 1);
    assert.ok(adopted.shapeId !== null);
  });

  test("keep theirs moves a marker and takes its class", () => {
    const theirs = colleague({ geometry: { type: "Point", coordinates: [7, 8] }, classId: "c-2" });
    const first = addShape(createDocument(), {
      kind: "point",
      points: Float32Array.from([1, 1]),
      classKey: "c-1",
    });
    const adopted = adoptTheirs(first.document, first.shape.id, theirs);
    const shape = adopted.document.shapes.get(first.shape.id);
    assert.deepEqual([...(shape?.points ?? [])], [7, 8]);
    assert.equal(shape?.classKey, "c-2");
  });

  test("the sketch frames both outlines", () => {
    const sketch = sketchOf(
      polygon([0, 0], [10, 0], [10, 10]),
      polygon([20, 0], [30, 0], [30, 10]),
    );
    const [x, y, width] = sketch.box;
    assert.ok(x < 0 && y < 0 && width > 30);
    assert.equal(sketch.mine?.kind, "polygon");
    assert.equal(sketch.theirs?.kind, "polygon");
    assert.equal(sketchOf(null, null).mine, null);
  });
});
