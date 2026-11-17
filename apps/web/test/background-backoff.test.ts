import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "@parfocal/api-client";
import { RoomClient, type SocketLike, type Timers } from "@parfocal/edge/room-client";
import {
  createRoomAccess,
  firstPauseMs,
  maxPauseMs,
  pauseFor,
} from "../src/presence/room-access.ts";
import {
  coverageRefused,
  coverageRefusedPauseMs,
  noteCoverageAnswer,
} from "../src/viewer/slide-coverage.ts";

type Pending = { at: number; run: () => void; id: number };

function fakeTime() {
  let now = 0;
  let nextId = 0;
  let pending: Pending[] = [];
  const timers: Timers = {
    set(run, ms) {
      nextId += 1;
      pending.push({ at: now + ms, run, id: nextId });
      return nextId;
    },
    clear(handle) {
      pending = pending.filter((entry) => entry.id !== handle);
    },
  };
  const settle = async () => {
    for (let round = 0; round < 5; round += 1) await Promise.resolve();
  };
  const advance = async (ms: number) => {
    const until = now + ms;
    for (;;) {
      await settle();
      const due = pending.filter((entry) => entry.at <= until).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      pending = pending.filter((entry) => entry !== due);
      now = due.at;
      due.run();
    }
    now = until;
    await settle();
  };
  return { timers, advance, clock: () => now };
}

const unavailable = () => new ApiError("server", 503);

const neverOpens = (): SocketLike => ({
  onopen: null,
  onmessage: null,
  onclose: null,
  send: () => undefined,
  close: () => undefined,
});

test("after a 503 two room clients ask for room access at most twice in a minute", async () => {
  const time = fakeTime();
  let calls = 0;
  const access = createRoomAccess(() => {
    calls += 1;
    return Promise.reject(unavailable());
  }, time.clock);
  const clients = ["user:me", "slide:one"].map(
    (room) =>
      new RoomClient({
        url: `wss://rooms.example.test/${room}`,
        ticket: () => access.ticket(room),
        open: neverOpens,
        refetch: () => undefined,
        onEvent: () => undefined,
        timers: time.timers,
      }),
  );
  for (const client of clients) client.start();
  await time.advance(60_000);
  assert.ok(calls <= 2, `asked ${calls} times in a minute`);
  for (const client of clients) client.stop();
});

test("room access is asked again after the pause, and right away on reconnect", async () => {
  const time = fakeTime();
  let calls = 0;
  const access = createRoomAccess(() => {
    calls += 1;
    return Promise.reject(unavailable());
  }, time.clock);
  const client = new RoomClient({
    url: "wss://rooms.example.test/user:me",
    ticket: () => access.ticket("user:me"),
    open: neverOpens,
    refetch: () => undefined,
    onEvent: () => undefined,
    timers: time.timers,
  });
  client.start();
  await time.advance(firstPauseMs + 31_000);
  assert.equal(calls, 2);
  access.reconnect();
  await time.advance(31_000);
  assert.equal(calls, 3);
  client.stop();
});

test("the pause grows and stops at its ceiling", () => {
  assert.equal(pauseFor(0), firstPauseMs);
  assert.equal(pauseFor(1), firstPauseMs * 2);
  assert.equal(pauseFor(10), maxPauseMs);
});

test("a refused room ends the client and an answer clears the pause", async () => {
  let answer: () => Promise<{ data: { token: string; lifetime_seconds: number } }> = () =>
    Promise.reject(new ApiError("forbidden", 403));
  const access = createRoomAccess(
    (_room) => answer(),
    () => 0,
  );
  assert.equal(await access.ticket("slide:one"), null);
  answer = () => Promise.reject(unavailable());
  await assert.rejects(access.ticket("slide:one"));
  assert.equal(access.pausedUntil(), firstPauseMs);
  access.reconnect();
  answer = () => Promise.resolve({ data: { token: "t", lifetime_seconds: 60 } });
  assert.deepEqual(await access.ticket("slide:one"), { token: "t", lifetimeSeconds: 60 });
  assert.equal(access.pausedUntil(), 0);
});

test("a 409 from slide coverage pauses its calls for that slide only", () => {
  noteCoverageAnswer("slide-a", new ApiError("server", 503), 0);
  assert.equal(coverageRefused("slide-a", 1), false);
  noteCoverageAnswer("slide-a", new ApiError("conflict", 409), 0);
  assert.equal(coverageRefused("slide-a", 1), true);
  assert.equal(coverageRefused("slide-b", 1), false);
  assert.equal(coverageRefused("slide-a", coverageRefusedPauseMs + 1), false);
});
