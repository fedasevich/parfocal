import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  recallSlideCamera,
  rememberSlideCamera,
  stepSlideId,
} from "../src/screens/review/slide-switch.ts";

const ids = ["a1", "a2", "b1"];
const day = 24 * 60 * 60 * 1000;
const t0 = 1_800_000_000_000;

const data = new Map<string, string>();
Object.assign(globalThis, {
  window: {
    localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    },
  },
});

beforeEach(() => data.clear());

test("Q and E step to the neighbours and stop at the ends", () => {
  assert.equal(stepSlideId(ids, "a2", 1), "b1");
  assert.equal(stepSlideId(ids, "a2", -1), "a1");
  assert.equal(stepSlideId(ids, "a1", -1), undefined);
  assert.equal(stepSlideId(ids, "b1", 1), undefined);
});

test("stepping from a slide outside the list does nothing", () => {
  assert.equal(stepSlideId(ids, "elsewhere", 1), undefined);
});

test("each slide keeps its own camera in the parfocal.slide-cameras key", () => {
  rememberSlideCamera("u1", "a1", { x: 0.2, y: 0.3, z: 4 }, t0);
  rememberSlideCamera("u1", "a2", { x: 0.7, y: 0.1, z: 1.5 }, t0);
  assert.deepEqual(recallSlideCamera("u1", "a1", t0), { x: 0.2, y: 0.3, z: 4 });
  assert.deepEqual(recallSlideCamera("u1", "a2", t0), { x: 0.7, y: 0.1, z: 1.5 });
  assert.deepEqual(recallSlideCamera("u1", "b1", t0), {});
  assert.ok(data.has("parfocal.slide-cameras"));
});

test("a camera missing a part is not remembered", () => {
  rememberSlideCamera("u1", "a1", { x: 0.5, y: 0.5 }, t0);
  assert.deepEqual(recallSlideCamera("u1", "a1", t0), {});
});

test("the newer camera of a slide replaces the older one", () => {
  rememberSlideCamera("u1", "a1", { x: 0.2, y: 0.3, z: 4 }, t0);
  rememberSlideCamera("u1", "a1", { x: 0.5, y: 0.5, z: 2 }, t0 + 1);
  assert.deepEqual(recallSlideCamera("u1", "a1", t0 + 1), { x: 0.5, y: 0.5, z: 2 });
});

test("entries older than 30 days are not recalled and are dropped on the next write", () => {
  rememberSlideCamera("u1", "old", { x: 0.1, y: 0.1, z: 1 }, t0);
  assert.deepEqual(recallSlideCamera("u1", "old", t0 + 30 * day), { x: 0.1, y: 0.1, z: 1 });
  assert.deepEqual(recallSlideCamera("u1", "old", t0 + 30 * day + 1), {});
  rememberSlideCamera("u1", "new", { x: 0.2, y: 0.2, z: 2 }, t0 + 31 * day);
  assert.ok(!(data.get("parfocal.slide-cameras") ?? "").includes("old"));
});

test("at most 200 slides are kept per user and the oldest go first", () => {
  for (let at = 0; at < 205; at += 1)
    rememberSlideCamera("u1", `s${at}`, { x: 0.5, y: 0.5, z: 2 }, t0 + at);
  const stored = JSON.parse(data.get("parfocal.slide-cameras") ?? "{}") as Record<string, object>;
  assert.equal(Object.keys(stored["u1"] ?? {}).length, 200);
  assert.deepEqual(recallSlideCamera("u1", "s4", t0 + 300), {});
  assert.deepEqual(recallSlideCamera("u1", "s5", t0 + 300), { x: 0.5, y: 0.5, z: 2 });
  assert.deepEqual(recallSlideCamera("u1", "s204", t0 + 300), { x: 0.5, y: 0.5, z: 2 });
});

test("two users on one device never read each other's cameras", () => {
  rememberSlideCamera("u1", "a1", { x: 0.2, y: 0.3, z: 4 }, t0);
  rememberSlideCamera("u2", "a1", { x: 0.9, y: 0.9, z: 8 }, t0);
  assert.deepEqual(recallSlideCamera("u1", "a1", t0), { x: 0.2, y: 0.3, z: 4 });
  assert.deepEqual(recallSlideCamera("u2", "a1", t0), { x: 0.9, y: 0.9, z: 8 });
  assert.deepEqual(recallSlideCamera("u3", "a1", t0), {});
});

test("without a user nothing is stored or recalled", () => {
  rememberSlideCamera(undefined, "a1", { x: 0.2, y: 0.3, z: 4 }, t0);
  assert.equal(data.size, 0);
  assert.deepEqual(recallSlideCamera(undefined, "a1", t0), {});
});

test("damaged storage reads as empty", () => {
  data.set("parfocal.slide-cameras", "{not json");
  assert.deepEqual(recallSlideCamera("u1", "a1", t0), {});
  rememberSlideCamera("u1", "a1", { x: 0.2, y: 0.3, z: 4 }, t0);
  assert.deepEqual(recallSlideCamera("u1", "a1", t0), { x: 0.2, y: 0.3, z: 4 });
});
