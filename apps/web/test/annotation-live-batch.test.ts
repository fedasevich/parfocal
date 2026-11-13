import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createLiveBatch,
  type LayerRecord,
  type LiveChange,
  planChanges,
  summarise,
} from "../src/annotations/live-batch.ts";
import type { Timers } from "../src/annotations/save-queue.ts";

const anna = "anna";
const me = "me";

const record = (id: string, version: number, by: string = anna): LayerRecord => ({
  id,
  version,
  kind: "region",
  geometry: { type: "Polygon", coordinates: [] },
  changed_by_user_id: by,
});

function manualTimers() {
  const waiting: { run: () => void; live: boolean; ms: number }[] = [];
  const timers: Timers = {
    set: (run, ms) => {
      const entry = { run, live: true, ms };
      waiting.push(entry);
      return entry;
    },
    clear: (handle) => {
      (handle as { live: boolean }).live = false;
    },
  };
  const live = () => waiting.filter((entry) => entry.live);
  const fire = () => {
    const entry = live()[0];
    assert.ok(entry, "a timer is waiting");
    entry.live = false;
    entry.run();
  };
  return { timers, live, fire };
}

function rig(options: { busy?: () => boolean; held?: () => ReadonlySet<string> } = {}) {
  const known = new Map<string, number>([["old", 1]]);
  const applied: LiveChange[][] = [];
  const clock = manualTimers();
  const batch = createLiveBatch({
    known: () => known,
    me: () => me,
    deletedHere: () => new Set(["gone"]),
    busy: options.busy ?? (() => false),
    protectedIds: options.held ?? (() => new Set()),
    apply: (changes) => {
      applied.push([...changes]);
      for (const change of changes) {
        if (change.kind === "remove") known.delete(change.annotationId);
        else known.set(change.annotationId, change.record.version);
      }
    },
    timers: clock.timers,
  });
  return { batch, known, applied, clock };
}

describe("planning changes", () => {
  test("finds added, edited and removed shapes and skips own and unchanged ones", () => {
    const plan = planChanges({
      known: new Map([
        ["kept", 2],
        ["edited", 1],
        ["removed", 1],
        ["mine", 1],
      ]),
      records: [
        record("kept", 2),
        record("edited", 2),
        record("added", 1),
        record("mine", 5, me),
        record("ownNew", 1, me),
        record("gone", 3),
      ],
      me,
      deletedHere: new Set(["gone"]),
    });
    assert.deepEqual(
      plan.map((change) => [change.kind, change.annotationId]),
      [
        ["edit", "edited"],
        ["add", "added"],
        ["remove", "removed"],
      ],
    );
  });

  test("names who changed what", () => {
    const plan = planChanges({
      known: new Map([["edited", 1]]),
      records: [record("edited", 2), record("a", 1), record("b", 1)],
      me,
      deletedHere: new Set(),
    });
    assert.deepEqual(summarise(plan), [{ by: anna, added: 2, changed: 1, removed: 0 }]);
  });
});

describe("holding a batch", () => {
  test("holds a colleague's change until the pause and then applies it once", () => {
    const { batch, applied, clock } = rig();
    batch.offer([record("old", 1), record("new", 1)]);
    assert.equal(batch.pending().length, 1);
    assert.equal(applied.length, 0);
    assert.equal(clock.live().length, 1);
    assert.equal(clock.live()[0]?.ms, 3000);
    clock.fire();
    assert.equal(applied.length, 1);
    assert.equal(applied[0]?.[0]?.annotationId, "new");
    assert.equal(batch.pending().length, 0);
    assert.equal(clock.live().length, 0);
  });

  test("keeps holding while the pointer moves because every move restarts the pause", () => {
    const { batch, applied, clock } = rig();
    batch.offer([record("old", 1), record("new", 1)]);
    const first = clock.live()[0];
    batch.touch();
    assert.equal(first?.live, false);
    assert.equal(clock.live().length, 1);
    batch.touch();
    assert.equal(clock.live().length, 1);
    assert.equal(applied.length, 0);
  });

  test("waits while the expert is busy and applies when the busy state ends", () => {
    let busy = true;
    const { batch, applied, clock } = rig({ busy: () => busy });
    batch.offer([record("old", 1), record("new", 1)]);
    clock.fire();
    assert.equal(applied.length, 0);
    assert.equal(batch.pending().length, 1);
    busy = false;
    clock.fire();
    assert.equal(applied.length, 1);
  });

  test("applies at once on the marker click", () => {
    const { batch, applied, clock } = rig();
    batch.offer([record("old", 1), record("a", 1), record("b", 1)]);
    batch.flushNow();
    assert.equal(applied.length, 1);
    assert.equal(applied[0]?.length, 2);
    assert.equal(batch.pending().length, 0);
    assert.equal(clock.live().length, 0);
  });

  test("never touches a shape being edited and applies the rest", () => {
    const { batch, applied } = rig({ held: () => new Set(["old"]) });
    batch.offer([record("old", 2), record("new", 1)]);
    batch.flushNow();
    assert.deepEqual(
      applied[0]?.map((change) => change.annotationId),
      ["new"],
    );
    assert.deepEqual(
      batch.pending().map((change) => change.annotationId),
      ["old"],
    );
  });

  test("applies the held change after the shape is let go", () => {
    let held = new Set(["old"]);
    const { batch, applied, clock } = rig({ held: () => held });
    batch.offer([record("old", 2)]);
    clock.fire();
    assert.equal(applied.length, 0);
    held = new Set();
    clock.fire();
    assert.equal(applied.length, 1);
    assert.equal(batch.pending().length, 0);
  });

  test("tells listeners when the marker changes and stops after dispose", () => {
    const { batch, clock } = rig();
    let heard = 0;
    batch.subscribe(() => {
      heard += 1;
    });
    batch.offer([record("old", 1), record("a", 1)]);
    assert.equal(heard, 1);
    batch.offer([record("old", 1), record("a", 1)]);
    assert.equal(heard, 1);
    batch.dispose();
    assert.equal(clock.live().length, 0);
  });
});
