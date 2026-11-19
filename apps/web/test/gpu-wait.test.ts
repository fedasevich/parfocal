import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { type GpuWaiting, getScoreViewMapTileUrl } from "@parfocal/api-client";
import {
  GpuCallCancelledError,
  type GpuOutcome,
  gpuWaits,
  untilGpuAnswers,
} from "../src/gpu/gpu-wait.ts";
import { fakeGpuQueued, queuedScorer, viewTilePoster } from "../src/results/view-map-scorer.ts";
import { createViewMapSession } from "../src/results/view-map-session.ts";

const realFetch = globalThis.fetch;
const slideId = "00000000-0000-4000-8005-000000000005";

afterEach(() => {
  globalThis.fetch = realFetch;
});

const waiting = (call: string, seconds: number): GpuWaiting => ({
  state: "waiting",
  call,
  waited_seconds: seconds,
  hold_seconds: 45,
});

test("a waiting call is polled with its token until the answer comes", async () => {
  const asked: (string | null)[] = [];
  const seen: number[] = [];
  const stop = gpuWaits.subscribe(() => {
    seen.push(gpuWaits.current().length);
  });
  const answers: GpuOutcome<string>[] = [
    { waiting: waiting("t1", 45) },
    { waiting: waiting("t2", 90) },
    { answered: "cells" },
  ];
  const answer = await untilGpuAnswers("typer", (call) => {
    asked.push(call);
    const next = answers.shift();
    assert.ok(next !== undefined);
    return Promise.resolve(next);
  });
  stop();
  assert.equal(answer, "cells");
  assert.deepEqual(asked, [null, "t1", "t2"]);
  assert.deepEqual(gpuWaits.current(), []);
  assert.equal(seen.at(-1), 0);
  assert.ok(seen.includes(1));
});

test("cancel aborts the poll, drops the wait and tells the server", async () => {
  const cancelled: string[] = [];
  let polls = 0;
  const pending = untilGpuAnswers(
    "view-map",
    (_call, signal) => {
      polls += 1;
      if (polls === 1) return Promise.resolve({ waiting: waiting("t1", 45) });
      return new Promise<GpuOutcome<string>>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    },
    (call) => {
      cancelled.push(call);
      return Promise.resolve();
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(gpuWaits.current().length, 1);
  assert.equal(gpuWaits.current()[0]?.kind, "view-map");
  gpuWaits.cancelAll();
  await assert.rejects(pending, GpuCallCancelledError);
  assert.deepEqual(cancelled, ["t1"]);
  assert.deepEqual(gpuWaits.current(), []);
});

test("the view tile poster sends the token back and reads cells after a 202", async () => {
  const urls: string[] = [];
  const replies = [
    Response.json(waiting("tok", 45), { status: 202 }),
    new Response(new Uint8Array([7, 8])),
  ];
  globalThis.fetch = (input) => {
    urls.push(input instanceof Request ? input.url : input.toString());
    const reply = replies.shift();
    assert.ok(reply !== undefined);
    return Promise.resolve(reply);
  };
  const values = await viewTilePoster(() => Promise.resolve())(slideId, 1, 2);
  assert.deepEqual([...values], [7, 8]);
  assert.deepEqual(urls, [
    getScoreViewMapTileUrl(slideId, 1, 2),
    getScoreViewMapTileUrl(slideId, 1, 2, { call: "tok" }),
  ]);
});

test("a cancelled view map rests instead of failing", async () => {
  assert.equal(fakeGpuQueued("?gpu=queued"), true);
  assert.equal(fakeGpuQueued(""), false);
  const slide = { width: 40_000, height: 30_000 };
  const session = createViewMapSession({ slide, scorer: queuedScorer(5) });
  const asked = session.ask({ x: 8_000, y: 8_000, width: 6_000, height: 4_000 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(session.getState().phase, "scoring");
  assert.ok(gpuWaits.current().length > 0);
  gpuWaits.cancelAll();
  await asked;
  assert.equal(session.getState().phase, "empty");
  assert.deepEqual(gpuWaits.current(), []);
});
