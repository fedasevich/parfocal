import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { SamEncoded, SamPromptOutcome } from "@parfocal/viewer-engine";
import { fakeOutputs, fakePatch } from "../src/aiseg/fake-sam.ts";
import { createPrewarmTrigger, prewarmStillMs } from "../src/aiseg/smart-prewarm.ts";
import { createSmartSession, type SmartReader, type SmartSam } from "../src/aiseg/smart-session.ts";

const slide = { width: 8192, height: 8192 };
const encodeMs = 900;
const promptMs = 40;
const firstClickBudgetMs = 150;
const engineLru = 6;

let clock = 0;

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

async function advance(ms: number) {
  await settle();
  mock.timers.tick(ms);
  clock += ms;
  await settle();
}

function anchoredReader(): SmartReader & { reads: number } {
  let anchor: ReturnType<typeof fakePatch> | null = null;
  const reader = {
    reads: 0,
    read(query: { x: number; y: number }) {
      reader.reads += 1;
      if (
        anchor !== null &&
        query.x >= anchor.x &&
        query.x < anchor.x + anchor.width &&
        query.y >= anchor.y &&
        query.y < anchor.y + anchor.height
      ) {
        return Promise.resolve({ patch: anchor });
      }
      anchor = fakePatch(slide, { preset: "nuclei", x: query.x, y: query.y });
      return Promise.resolve({ patch: anchor });
    },
  };
  return reader;
}

function slowSam() {
  const order: string[] = [];
  const encodes: string[] = [];
  const sam: SmartSam = {
    encode(id) {
      encodes.push(id);
      return new Promise<SamEncoded>((resolve) => {
        setTimeout(() => {
          const at = order.indexOf(id);
          if (at >= 0) order.splice(at, 1);
          order.push(id);
          const evicted = order.length > engineLru ? order.splice(0, order.length - engineLru) : [];
          resolve({ id, ms: encodeMs, evicted });
        }, encodeMs);
      });
    },
    prompt(_id, prompt) {
      return new Promise<SamPromptOutcome>((resolve) => {
        setTimeout(
          () => resolve({ status: "answer", outputs: fakeOutputs(prompt), ms: promptMs }),
          promptMs,
        );
      });
    },
  };
  return { sam, encodes };
}

function open() {
  const reader = anchoredReader();
  const { sam, encodes } = slowSam();
  const session = createSmartSession({ slideId: "s", reader, sam, onChange: () => undefined });
  return { reader, session, encodes };
}

async function timeUntil(done: Promise<void>): Promise<number> {
  let finished = false;
  void done.then(() => {
    finished = true;
  });
  const started = clock;
  while (!finished && clock - started < 5000) await advance(5);
  return clock - started;
}

const centre = { x: 4096, y: 4096 };
const nearCentre = { x: 4140, y: 4080 };

const click = (at: { x: number; y: number }) =>
  ({ kind: "point", at, positive: true, extend: false }) as const;

beforeEach(() => {
  clock = 0;
  mock.timers.enable({ apis: ["setTimeout"] });
});

afterEach(() => {
  mock.timers.reset();
});

describe("prewarm trigger", () => {
  function fakeTimers() {
    const pending = new Map<number, { run: () => void; due: number }>();
    let now = 0;
    let next = 0;
    return {
      timers: {
        set: (run: () => void, ms: number) => {
          next += 1;
          pending.set(next, { run, due: now + ms });
          return next;
        },
        clear: (handle: unknown) => {
          pending.delete(handle as number);
        },
      },
      advance(ms: number) {
        now += ms;
        for (const [handle, entry] of [...pending]) {
          if (entry.due <= now) {
            pending.delete(handle);
            entry.run();
          }
        }
      },
    };
  }

  it("fires once after 350 ms without a touch", () => {
    const fake = fakeTimers();
    let fired = 0;
    const trigger = createPrewarmTrigger({
      timers: fake.timers,
      pause: () => undefined,
      fire: () => {
        fired += 1;
      },
    });
    trigger.touch();
    fake.advance(prewarmStillMs - 1);
    assert.equal(fired, 0);
    fake.advance(1);
    assert.equal(fired, 1);
    fake.advance(1000);
    assert.equal(fired, 1);
  });

  it("restarts the wait on every touch and pauses while the camera moves", () => {
    const fake = fakeTimers();
    let fired = 0;
    let paused = 0;
    const trigger = createPrewarmTrigger({
      timers: fake.timers,
      pause: () => {
        paused += 1;
      },
      fire: () => {
        fired += 1;
      },
    });
    for (let step = 0; step < 10; step++) {
      trigger.touch();
      fake.advance(prewarmStillMs - 50);
    }
    assert.equal(fired, 0);
    assert.equal(paused, 10);
    fake.advance(50);
    assert.equal(fired, 1);
  });

  it("stop cancels a pending prewarm", () => {
    const fake = fakeTimers();
    let fired = 0;
    const trigger = createPrewarmTrigger({
      timers: fake.timers,
      pause: () => undefined,
      fire: () => {
        fired += 1;
      },
    });
    trigger.touch();
    trigger.stop();
    fake.advance(1000);
    assert.equal(fired, 0);
  });
});

describe("prewarmed first click", () => {
  it("answers a cold first click only after the encoder has run", async () => {
    const { session, encodes } = open();
    const elapsed = await timeUntil(session.press(click(centre)));
    assert.equal(encodes.length, 1);
    assert.ok(elapsed >= encodeMs, `cold click took ${elapsed} ms`);
  });

  it("answers the first click on a prewarmed view in under 150 ms", async () => {
    const { session, encodes } = open();
    await timeUntil(session.prewarm(centre));
    assert.equal(encodes.length, 1);
    const elapsed = await timeUntil(session.press(click(nearCentre)));
    assert.equal(encodes.length, 1);
    assert.ok(elapsed < firstClickBudgetMs, `prewarmed click took ${elapsed} ms`);
    assert.ok(session.snapshot().live?.ring);
  });

  it("shares one encode when the click lands while the prewarm is still encoding", async () => {
    const { session, encodes } = open();
    const warming = session.prewarm(centre);
    await advance(200);
    const elapsed = await timeUntil(session.press(click(nearCentre)));
    await warming;
    assert.equal(encodes.length, 1);
    assert.ok(elapsed < encodeMs + promptMs);
  });

  it("encodes the view once however often it is prewarmed", async () => {
    const { session, encodes } = open();
    await timeUntil(session.prewarm(centre));
    await timeUntil(session.prewarm(nearCentre));
    await timeUntil(session.prewarm(centre));
    assert.equal(encodes.length, 1);
  });

  it("starts no encode when the camera moved again before the patch arrived", async () => {
    const { session, encodes } = open();
    const warming = session.prewarm(centre);
    session.pausePrewarm();
    await warming;
    await advance(encodeMs * 2);
    assert.deepEqual(encodes, []);
  });

  it("forgets the views the worker evicted from its six embeddings", async () => {
    const { session, encodes } = open();
    const views = Array.from({ length: engineLru + 1 }, (_, index) => ({
      x: 600 + index * 1000,
      y: 600,
    }));
    for (const view of views) await timeUntil(session.prewarm(view));
    assert.equal(encodes.length, engineLru + 1);
    await timeUntil(session.prewarm(views[engineLru] ?? centre));
    assert.equal(encodes.length, engineLru + 1);
    await timeUntil(session.prewarm(views[0] ?? centre));
    assert.equal(encodes.length, engineLru + 2);
  });

  it("ignores a prewarm after the session closed", async () => {
    const { session, encodes, reader } = open();
    session.close();
    await session.prewarm(centre);
    assert.equal(encodes.length, 0);
    assert.equal(reader.reads, 0);
  });
});
