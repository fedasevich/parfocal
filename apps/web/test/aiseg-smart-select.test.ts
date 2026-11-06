import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bestMask, samFrame, samImageSize, samPixels, slideToModel } from "@parfocal/viewer-engine";
import {
  createFakeReader,
  createFakeSam,
  fakeBestCandidate,
  fakeDiscRadius,
  fakeOutputs,
} from "../src/aiseg/fake-sam.ts";
import { nextRunId, smartRunFinished, withSmartRun } from "../src/aiseg/smart-run.ts";
import {
  classifyPress,
  emptyPrompts,
  normalisedBox,
  withBox,
  withoutLast,
  withPoint,
} from "../src/aiseg/smart-select.ts";
import {
  createSmartSession,
  type SmartSession,
  type SmartSnapshot,
} from "../src/aiseg/smart-session.ts";
import { createDocument } from "../src/annotations/document.ts";
import {
  acceptProposals,
  discardProposals,
  pendingProposals,
} from "../src/annotations/proposals.ts";

const slide = { width: 4096, height: 4096 };

function bounds(ring: Float32Array) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    x0 = Math.min(x0, ring[i] ?? 0);
    x1 = Math.max(x1, ring[i] ?? 0);
    y0 = Math.min(y0, ring[i + 1] ?? 0);
    y1 = Math.max(y1, ring[i + 1] ?? 0);
  }
  return { x0, y0, x1, y1 };
}

function open() {
  const sam = createFakeSam();
  const changes: SmartSnapshot[] = [];
  const session: SmartSession = createSmartSession({
    slideId: "slide-1",
    reader: createFakeReader(slide),
    sam,
    onChange: (snapshot) => changes.push(snapshot),
  });
  return { sam, session, changes };
}

const click = (x: number, y: number, extra: { positive?: boolean; extend?: boolean } = {}) =>
  ({
    kind: "point",
    at: { x, y },
    positive: extra.positive ?? true,
    extend: extra.extend ?? false,
  }) as const;

describe("press classification", () => {
  it("reads each gesture the task names", () => {
    const base = { altKey: false, shiftKey: false, movedScreenPixels: 0 };
    assert.deepEqual(classifyPress({ ...base, button: 0 }), {
      kind: "point",
      positive: true,
      extend: false,
    });
    assert.deepEqual(classifyPress({ ...base, button: 0, shiftKey: true }), {
      kind: "point",
      positive: true,
      extend: true,
    });
    assert.deepEqual(classifyPress({ ...base, button: 2 }), {
      kind: "point",
      positive: false,
      extend: true,
    });
    assert.deepEqual(classifyPress({ ...base, button: 0, altKey: true }), {
      kind: "point",
      positive: false,
      extend: true,
    });
    assert.deepEqual(classifyPress({ ...base, button: 0, movedScreenPixels: 30 }), {
      kind: "box",
    });
    assert.equal(classifyPress({ ...base, button: 1 }), null);
  });

  it("removes the last point and then the box", () => {
    let prompts = withBox(
      withPoint(withPoint(emptyPrompts, { x: 1, y: 1, positive: true }), {
        x: 2,
        y: 2,
        positive: false,
      }),
      normalisedBox({ x: 9, y: 9 }, { x: 3, y: 4 }),
    );
    assert.deepEqual(prompts.box, { x0: 3, y0: 4, x1: 9, y1: 9 });
    prompts = withoutLast(prompts);
    assert.equal(prompts.points.length, 1);
    assert.notEqual(prompts.box, null);
    prompts = withoutLast(withoutLast(prompts));
    assert.equal(prompts.points.length, 0);
    assert.equal(prompts.box, null);
  });
});

describe("model input", () => {
  it("normalises pixels like the Python contract and pads nothing for a square patch", () => {
    const patch = { x: 0, y: 0, width: 4, height: 4, downsample: 1 };
    const frame = samFrame(patch);
    const rgb = new Uint8Array(4 * 4 * 3);
    for (let i = 0; i < 16; i++) rgb.set([123, 116, 104], i * 3);
    const pixels = samPixels(rgb, frame);
    const plane = samImageSize * samImageSize;
    assert.equal(pixels.length, 3 * plane);
    assert.ok(Math.abs((pixels[0] ?? 9) - (123 - 123.675) / 58.395) < 1e-5);
    assert.ok(Math.abs((pixels[plane + 5] ?? 9) - (116 - 116.28) / 57.12) < 1e-5);
    assert.ok(Math.abs((pixels[3 * plane - 1] ?? 9) - (104 - 103.53) / 57.375) < 1e-5);
  });

  it("picks the best of all four candidates and keeps its low-resolution logits", () => {
    const outputs = fakeOutputs({ points: [{ x: 500, y: 500, positive: true }] });
    const best = bestMask(outputs);
    assert.equal(best.index, fakeBestCandidate);
    assert.equal(best.count, 4);
    assert.equal(best.lowRes.length, 256 * 256);
    assert.equal(best.logits.length, samImageSize * samImageSize);
    assert.ok(best.score > 0.9);
    const frame = samFrame({ x: 1000, y: 2000, width: 512, height: 512, downsample: 1 });
    assert.deepEqual(slideToModel(frame, { x: 1256, y: 2256 }), { x: 512, y: 512 });
  });
});

describe("smart select session", () => {
  it("a click is a positive point and the outline surrounds it", async () => {
    const { session, sam } = open();
    await session.press(click(1000, 1000));
    const live = session.snapshot().live;
    assert.notEqual(live, null);
    const first = sam.prompts[0]?.prompt;
    assert.equal(first?.points.length, 1);
    assert.equal(first?.points[0]?.positive, true);
    assert.equal(first?.previousLogits ?? null, null);
    const box = bounds(live?.ring ?? new Float32Array());
    const radius = fakeDiscRadius / 2;
    assert.ok(Math.abs(box.x0 - (1000 - radius)) < 1.5, `x0 ${box.x0}`);
    assert.ok(Math.abs(box.x1 - (1000 + radius)) < 1.5, `x1 ${box.x1}`);
    assert.ok(Math.abs(box.y0 - (1000 - radius)) < 1.5, `y0 ${box.y0}`);
    assert.equal(session.snapshot().phase, "ready");
    assert.ok((live?.confidence ?? 0) > 0.9);
  });

  it("encodes a patch once and reuses it for refinement", async () => {
    const { session, sam } = open();
    await session.press(click(1000, 1000));
    await session.press(click(1005, 1000, { extend: true }));
    assert.equal(sam.encodes.length, 1);
  });

  it("shift+click extends the same object and feeds the previous logits back", async () => {
    const { session, sam } = open();
    await session.press(click(1000, 1000));
    await session.press(click(1030, 1000, { extend: true }));
    const snapshot = session.snapshot();
    assert.equal(snapshot.kept.length, 0);
    const second = sam.prompts[1]?.prompt;
    assert.equal(second?.points.length, 2);
    assert.equal(second?.previousLogits?.length, 256 * 256);
    const box = bounds(snapshot.live?.ring ?? new Float32Array());
    assert.ok(box.x1 > 1000 + fakeDiscRadius / 2 + 20);
  });

  it("a right click or alt+click is a negative point that cuts the object", async () => {
    const { session, sam } = open();
    await session.press(click(1000, 1000));
    const before = bounds(session.snapshot().live?.ring ?? new Float32Array());
    await session.press(click(1012, 1000, { positive: false, extend: true }));
    const negative = sam.prompts[1]?.prompt.points[1];
    assert.equal(negative?.positive, false);
    const after = bounds(session.snapshot().live?.ring ?? new Float32Array());
    assert.ok(after.x1 < before.x1 - 2, `${after.x1} against ${before.x1}`);
  });

  it("a negative point with nothing to refine does nothing", async () => {
    const { session, sam } = open();
    await session.press(click(1000, 1000, { positive: false, extend: true }));
    assert.equal(sam.prompts.length, 0);
    assert.equal(session.snapshot().live, null);
  });

  it("a plain click keeps the live object and starts a new one", async () => {
    const { session } = open();
    await session.press(click(1000, 1000));
    await session.press(click(1100, 1000));
    const snapshot = session.snapshot();
    assert.equal(snapshot.kept.length, 1);
    assert.notEqual(snapshot.live?.ring, null);
    const kept = bounds(snapshot.kept[0]?.ring ?? new Float32Array());
    const live = bounds(snapshot.live?.ring ?? new Float32Array());
    assert.ok(kept.x1 < live.x0 + 25);
    assert.ok(live.x0 > 1050);
  });

  it("a drag is a box prompt, never a box derived from a mask", async () => {
    const { session, sam } = open();
    await session.press({ kind: "box", from: { x: 2000, y: 2000 }, to: { x: 2060, y: 2040 } });
    const prompt = sam.prompts[0]?.prompt;
    assert.equal(prompt?.points.length, 0);
    assert.deepEqual(prompt?.box, { x0: 452, y0: 472, x1: 572, y1: 552 });
    const box = bounds(session.snapshot().live?.ring ?? new Float32Array());
    assert.ok(Math.abs(box.x0 - 2000) < 1.5);
    assert.ok(Math.abs(box.x1 - 2060) < 1.5);
    assert.ok(Math.abs(box.y1 - 2040) < 1.5);
  });

  it("Backspace removes the last point, then the box, and reruns on what is left", async () => {
    const { session, sam } = open();
    await session.press(click(1000, 1000));
    await session.press(click(1030, 1000, { extend: true }));
    await session.removeLast();
    const rerun = sam.prompts[2]?.prompt;
    assert.equal(rerun?.points.length, 1);
    assert.equal(rerun?.previousLogits ?? null, null);
    const box = bounds(session.snapshot().live?.ring ?? new Float32Array());
    assert.ok(box.x1 < 1000 + fakeDiscRadius / 2 + 2);
    await session.removeLast();
    assert.equal(session.snapshot().live, null);
    assert.equal(session.snapshot().phase, "idle");
  });

  it("Backspace takes the box back once no points remain", async () => {
    const { session, sam } = open();
    await session.press({ kind: "box", from: { x: 2000, y: 2000 }, to: { x: 2060, y: 2040 } });
    await session.press(click(2030, 2020, { extend: true }));
    await session.removeLast();
    assert.notEqual(sam.prompts.at(-1)?.prompt.box, null);
    assert.equal(sam.prompts.at(-1)?.prompt.points.length, 0);
    await session.removeLast();
    assert.equal(session.snapshot().live, null);
  });

  it("ignores a refinement point outside the area being refined", async () => {
    const { session, sam } = open();
    await session.press(click(1000, 1000));
    await session.press(click(3000, 3000, { extend: true }));
    assert.equal(sam.prompts.length, 1);
    assert.equal(session.snapshot().phase, "outside");
  });

  it("answers only the latest of two quick prompts", async () => {
    const { session, changes } = open();
    const first = session.press(click(1000, 1000));
    const second = session.press(click(1030, 1000, { extend: true }));
    await Promise.all([first, second]);
    const live = session.snapshot().live;
    assert.equal(live?.prompts.points.length, 2);
    assert.equal(session.snapshot().phase, "ready");
    assert.ok(changes.length > 2);
  });

  it("reset clears everything and close stops publishing", async () => {
    const { session, changes } = open();
    await session.press(click(1000, 1000));
    session.reset();
    assert.equal(session.snapshot().live, null);
    assert.equal(session.snapshot().kept.length, 0);
    const seen = changes.length;
    session.close();
    await session.press(click(1000, 1000));
    assert.equal(changes.length, seen);
  });

  it("reports a failure when the encoder or decoder throws", async () => {
    const failing = createSmartSession({
      slideId: "s",
      reader: createFakeReader(slide),
      sam: {
        encode() {
          return Promise.reject(new Error("no memory"));
        },
        prompt() {
          return Promise.resolve({ status: "stale" });
        },
      },
      onChange: () => undefined,
    });
    await failing.press(click(1000, 1000));
    assert.equal(failing.snapshot().phase, "failed");
    assert.equal(failing.snapshot().message, "no memory");
  });
});

describe("smart select proposals", () => {
  it("keeps one run of pending pieces that Accept turns into shapes with the model's provenance", async () => {
    const { session } = open();
    await session.press(click(1000, 1000));
    await session.press(click(1100, 1000));
    let document = withSmartRun(
      createDocument(),
      nextRunId(createDocument()),
      "tumour",
      session.snapshot(),
    );
    assert.equal(pendingProposals(document).length, 2);
    assert.equal(smartRunFinished(document, 1), false);
    const accepted = acceptProposals(document);
    assert.equal(accepted.shapes.length, 2);
    assert.equal(accepted.shapes[0]?.classKey, "tumour");
    assert.equal(smartRunFinished(accepted.document, 1), true);
    document = withSmartRun(document, 1, "tumour", session.snapshot());
    assert.equal(smartRunFinished(discardProposals(document), 1), true);
  });

  it("drops the run when no outline is left", () => {
    const empty = { kept: [], live: null, phase: "idle", message: null } as const;
    const document = withSmartRun(createDocument(), 1, null, empty);
    assert.equal(document.runs.size, 0);
  });
});
