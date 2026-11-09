import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewObject } from "@parfocal/api-client";
import { shownSetsOf, withShownSet } from "../src/screens/review/display-model.ts";
import { createLatestQueue, saveThenChoose } from "../src/screens/review/display-saves.ts";
import { orderObjects, zoomedCamera } from "../src/screens/review/guided-drive.ts";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test("Save as removes the preset it just made when the second save fails", async () => {
  const removed: string[] = [];
  await assert.rejects(
    saveThenChoose({
      save: () => Promise.resolve({ id: "preset-1" }),
      choose: () => Promise.reject(new Error("network")),
      discard: (saved) => {
        removed.push(saved.id);
        return Promise.resolve();
      },
    }),
    /network/,
  );
  assert.deepEqual(removed, ["preset-1"]);
});

test("Save as keeps the preset when the second save works", async () => {
  const removed: string[] = [];
  const saved = await saveThenChoose({
    save: () => Promise.resolve({ id: "preset-2" }),
    choose: () => Promise.resolve(),
    discard: (made) => {
      removed.push(made.id);
      return Promise.resolve();
    },
  });
  assert.equal(saved.id, "preset-2");
  assert.deepEqual(removed, []);
});

test("Save as still reports the failure when removing the orphan fails too", async () => {
  await assert.rejects(
    saveThenChoose({
      save: () => Promise.resolve({ id: "preset-3" }),
      choose: () => Promise.reject(new Error("first")),
      discard: () => Promise.reject(new Error("second")),
    }),
    /first/,
  );
});

test("rapid presses are sent one after the other and the last one is what is applied", async () => {
  const queue = createLatestQueue();
  const sent: string[] = [];
  const applied: string[] = [];
  const first = deferred<string>();
  const second = deferred<string>();
  const one = queue.run(
    () => {
      sent.push("first");
      return first.promise;
    },
    (result) => applied.push(result),
    () => undefined,
  );
  const two = queue.run(
    () => {
      sent.push("second");
      return second.promise;
    },
    (result) => applied.push(result),
    () => undefined,
  );
  await Promise.resolve();
  assert.deepEqual(sent, ["first"]);
  assert.equal(queue.idle(), false);
  first.resolve("one");
  await one;
  assert.deepEqual(sent, ["first", "second"]);
  second.resolve("two");
  await two;
  assert.deepEqual(applied, ["two"]);
  assert.equal(queue.idle(), true);
});

test("a failed press recovers and does not block the next one", async () => {
  const queue = createLatestQueue();
  const events: string[] = [];
  await queue.run(
    () => Promise.reject(new Error("down")),
    () => events.push("applied"),
    () => events.push("recovered"),
  );
  await queue.run(
    () => Promise.resolve("ok"),
    () => events.push("applied"),
    () => events.push("recovered"),
  );
  assert.deepEqual(events, ["recovered", "applied"]);
  assert.equal(queue.idle(), true);
});

const object = (name: string, kind: "region" | "cell", score: number, size: number | null) =>
  ({
    object: name,
    kind,
    number: 1,
    class_name: "Tumor",
    score,
    size_mm: size,
    other_class: null,
  }) satisfies ReviewObject;

const mixed = [
  object("C1", "cell", 0.9, null),
  object("T1", "region", 0.8, 2),
  object("T2", "region", 0.4, 5),
  object("C2", "cell", 0.2, null),
  object("T3", "region", 0.6, 3),
];

const names = (items: ReviewObject[]) => items.map((item) => item.object);

test("order ai keeps the server order", () => {
  assert.deepEqual(names(orderObjects(mixed, "ai", "s")), names(mixed));
});

test("order size puts the largest first and keeps regions before cells", () => {
  assert.deepEqual(names(orderObjects(mixed, "size", "s")), ["T2", "T3", "T1", "C1", "C2"]);
});

test("order least sure puts the lowest score first", () => {
  assert.deepEqual(names(orderObjects(mixed, "leastsure", "s")), ["T2", "T3", "T1", "C2", "C1"]);
});

test("order random is the same for one seed and differs between seeds", () => {
  const a = names(orderObjects(mixed, "random", "task-1"));
  assert.deepEqual(a, names(orderObjects(mixed, "random", "task-1")));
  assert.deepEqual([...a].sort(), ["C1", "C2", "T1", "T2", "T3"]);
  const seeds = ["a", "b", "c", "d", "e", "f"].map((seed) =>
    names(orderObjects(mixed, "random", seed)).join(),
  );
  assert.ok(new Set(seeds).size > 1);
});

test("zoom scales the home camera and fit leaves it alone", () => {
  const home = { x: 10, y: 20, scale: 2 };
  assert.deepEqual(zoomedCamera(home, "fit"), home);
  assert.ok(zoomedCamera(home, "tight").scale > 2);
  assert.ok(zoomedCamera(home, "context").scale < 2);
  assert.deepEqual(zoomedCamera(home, "unknown"), home);
});

test("the other sets choice reads back and changes one set at a time", () => {
  assert.deepEqual(shownSetsOf(undefined), { reviewed: true });
  const added = withShownSet(undefined, "set-b", true);
  assert.deepEqual(added, { reviewed_layer: true, result_set_ids: ["set-b"] });
  assert.deepEqual(shownSetsOf({ other_sets: added }), { reviewed: true, "set-b": true });
  const hidden = withShownSet(withShownSet(added, "reviewed", false), "set-b", false);
  assert.deepEqual(hidden, { reviewed_layer: false, result_set_ids: [] });
});
