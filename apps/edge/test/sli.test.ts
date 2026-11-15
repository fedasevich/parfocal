import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTileSliCounter,
  flushAfterMs,
  flushTileSli,
  sliBatchPrefix,
  tileSli,
} from "../src/sli.ts";

const start = Date.UTC(2026, 10, 15, 9, 0, 0);

function clock() {
  let at = start;
  return { now: () => at, advance: (ms: number) => (at += ms) };
}

function memoryBucket() {
  const objects = new Map<string, string>();
  return {
    objects,
    put: (key: string, body: string) => {
      objects.set(key, body);
      return Promise.resolve();
    },
  };
}

test("a slow or failed tile counts as bad and a refused token is not counted", () => {
  const time = clock();
  const counter = createTileSliCounter(time.now);
  counter.observe(206, 20);
  counter.observe(206, 95);
  counter.observe(500, 5);
  counter.observe(401, 1);
  assert.deepEqual(counter.drain(), { [tileSli]: { [String(start / 1000)]: [3, 2] } });
  assert.equal(counter.drain(), null);
});

test("counts are flushed as one batch per isolate once they are 30 seconds old", async () => {
  const time = clock();
  const counter = createTileSliCounter(time.now);
  const bucket = memoryBucket();
  counter.observe(200, 10);
  assert.equal(counter.due(), false);
  time.advance(flushAfterMs);
  assert.equal(counter.due(), true);
  await flushTileSli(counter, bucket, time.now, () => "abc");
  const key = `${sliBatchPrefix}${(start + flushAfterMs) / 1000}-abc.json`;
  assert.deepEqual([...bucket.objects.keys()], [key]);
  assert.deepEqual(JSON.parse(bucket.objects.get(key) ?? "null"), {
    [tileSli]: { [String(start / 1000)]: [1, 0] },
  });
  assert.equal(counter.due(), false);
});

test("a failing bucket loses the batch without failing the tile request", async () => {
  const time = clock();
  const counter = createTileSliCounter(time.now);
  counter.observe(200, 10);
  const failing = { put: () => Promise.reject(new Error("down")) };
  const warn = console.warn;
  console.warn = () => {};
  try {
    await flushTileSli(counter, failing, time.now);
  } finally {
    console.warn = warn;
  }
  assert.equal(counter.drain(), null);
});
