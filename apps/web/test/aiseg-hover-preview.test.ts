import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SamPrompt, SamPromptOutcome } from "@parfocal/viewer-engine";
import { createFakeReader, createFakeSam, fakeOutputs } from "../src/aiseg/fake-sam.ts";
import { createSmartSession, type SmartSam } from "../src/aiseg/smart-session.ts";

const slide = { width: 4096, height: 4096 };

interface Gate {
  readonly sam: SmartSam;
  readonly prompts: SamPrompt[];
  release(): void;
}

function gated(): Gate {
  const base = createFakeSam();
  const prompts: SamPrompt[] = [];
  const waiting: Array<() => void> = [];
  let held = true;
  return {
    prompts,
    release() {
      held = false;
      for (const go of waiting.splice(0)) go();
    },
    sam: {
      encode: base.encode,
      async prompt(_id, prompt): Promise<SamPromptOutcome> {
        prompts.push(prompt);
        if (held) await new Promise<void>((resolve) => waiting.push(resolve));
        return { status: "answer", outputs: fakeOutputs(prompt), ms: 1 };
      },
    },
  };
}

function open(sam: SmartSam = createFakeSam()) {
  const hovers: Array<Float32Array | null> = [];
  const session = createSmartSession({
    slideId: "slide-1",
    reader: createFakeReader(slide),
    sam,
    onChange: () => undefined,
    onHover: (ring) => hovers.push(ring),
  });
  return { session, hovers };
}

const lastHover = (hovers: Array<Float32Array | null>) => hovers[hovers.length - 1] ?? null;

describe("hover preview", () => {
  it("shows nothing until the embedding of a patch holding the pointer is cached", async () => {
    const sam = createFakeSam();
    const { session, hovers } = open(sam);
    await session.hover({ x: 1000, y: 1000 });
    assert.equal(sam.prompts.length, 0);
    assert.equal(sam.encodes.length, 0);
    assert.equal(lastHover(hovers), null);
    await session.prewarm({ x: 1000, y: 1000 });
    await session.hover({ x: 1000, y: 1000 });
    assert.equal(sam.prompts.length, 1);
    assert.equal(sam.encodes.length, 1);
    assert.ok((lastHover(hovers)?.length ?? 0) >= 6);
  });

  it("never reads pixels or encodes for a pointer outside every cached patch", async () => {
    const sam = createFakeSam();
    const { session, hovers } = open(sam);
    await session.prewarm({ x: 1000, y: 1000 });
    await session.hover({ x: 1000, y: 1000 });
    assert.notEqual(lastHover(hovers), null);
    await session.hover({ x: 3000, y: 3000 });
    assert.equal(sam.encodes.length, 1);
    assert.equal(sam.prompts.length, 1);
    assert.equal(lastHover(hovers), null);
  });

  it("keeps one request in flight and answers only the latest position", async () => {
    const gate = gated();
    const { session, hovers } = open(gate.sam);
    await session.prewarm({ x: 1000, y: 1000 });
    const running = session.hover({ x: 900, y: 1000 });
    void session.hover({ x: 910, y: 1000 });
    void session.hover({ x: 920, y: 1000 });
    const latest = session.hover({ x: 1100, y: 1000 });
    await Promise.resolve();
    assert.equal(gate.prompts.length, 1);
    gate.release();
    await Promise.all([running, latest]);
    assert.equal(gate.prompts.length, 2);
    assert.equal(hovers.length, 2);
    const ring = lastHover(hovers) ?? new Float32Array();
    const xs = Array.from(ring).filter((_, index) => index % 2 === 0);
    const middle = (Math.min(...xs) + Math.max(...xs)) / 2;
    assert.ok(Math.abs(middle - 1100) < 4, `centre ${middle}`);
  });

  it("caches by prompt so the same pixel decodes once and the click that follows is free", async () => {
    const sam = createFakeSam();
    const { session, hovers } = open(sam);
    await session.prewarm({ x: 1000, y: 1000 });
    await session.hover({ x: 1000, y: 1000 });
    await session.hover({ x: 1010, y: 1000 });
    await session.hover({ x: 1000, y: 1000 });
    assert.equal(sam.prompts.length, 2);
    const shown = hovers.length;
    await session.hover({ x: 1000.2, y: 1000.1 });
    assert.equal(sam.prompts.length, 2);
    assert.equal(hovers.length, shown);
    await session.press({
      kind: "point",
      at: { x: 1000, y: 1000 },
      positive: true,
      extend: false,
    });
    assert.equal(sam.prompts.length, 2);
    const snapshot = session.snapshot();
    assert.equal(snapshot.phase, "ready");
    assert.notEqual(snapshot.live?.ring, null);
    assert.equal(lastHover(hovers), null);
  });

  it("a click then refines from the cached logits", async () => {
    const sam = createFakeSam();
    const { session } = open(sam);
    await session.prewarm({ x: 1000, y: 1000 });
    await session.hover({ x: 1000, y: 1000 });
    await session.press({
      kind: "point",
      at: { x: 1000, y: 1000 },
      positive: true,
      extend: false,
    });
    await session.press({
      kind: "point",
      at: { x: 1010, y: 1000 },
      positive: true,
      extend: true,
    });
    assert.equal(sam.prompts.length, 2);
    assert.notEqual(sam.prompts[1]?.prompt.previousLogits ?? null, null);
    assert.equal(sam.encodes.length, 1);
  });

  it("previews adding a point to the live object while extending", async () => {
    const sam = createFakeSam();
    const { session, hovers } = open(sam);
    await session.press({
      kind: "point",
      at: { x: 1000, y: 1000 },
      positive: true,
      extend: false,
    });
    await session.hover({ x: 1020, y: 1000 }, true);
    const preview = sam.prompts[sam.prompts.length - 1]?.prompt;
    assert.equal(preview?.points.length, 2);
    assert.notEqual(preview?.previousLogits ?? null, null);
    assert.notEqual(lastHover(hovers), null);
    assert.equal(session.snapshot().live?.prompts.points.length, 1);
  });

  it("clearing and pressing both take the outline away and drop an answer still pending", async () => {
    const gate = gated();
    const { session, hovers } = open(gate.sam);
    await session.prewarm({ x: 1000, y: 1000 });
    const pending = session.hover({ x: 1000, y: 1000 });
    await Promise.resolve();
    session.clearHover();
    gate.release();
    await pending;
    assert.equal(lastHover(hovers), null);
    assert.equal(
      hovers.filter((ring) => ring !== null).length,
      0,
      "a cleared request must not show its late answer",
    );
  });

  it("stops after close", async () => {
    const sam = createFakeSam();
    const { session, hovers } = open(sam);
    await session.prewarm({ x: 1000, y: 1000 });
    session.close();
    await session.hover({ x: 1000, y: 1000 });
    assert.equal(sam.prompts.length, 0);
    assert.equal(hovers.length, 0);
  });
});
