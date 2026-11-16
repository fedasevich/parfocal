import assert from "node:assert/strict";
import { test } from "node:test";
import { createFrame, type Frame } from "#frame.ts";
import { syntheticHeTile } from "#synthetic-tile.ts";
import {
  baselineFor,
  isBootstrapping,
  judgeVisual,
  staleBaselines,
  UI_TOLERANCE,
  visualCase,
  visualCases,
  visualName,
} from "#visual.ts";

const page = syntheticHeTile(64);

function copy(frame: Frame): Frame {
  return createFrame(frame.width, frame.height, new Uint8Array(frame.data));
}

function withBorder(frame: Frame, colour: readonly [number, number, number]): Frame {
  const data = new Uint8Array(frame.data);
  for (let x = 0; x < frame.width; x++) {
    for (const y of [0, frame.height - 1]) {
      data.set([...colour, 255], (y * frame.width + x) * 4);
    }
  }
  return createFrame(frame.width, frame.height, data);
}

function jitter(frame: Frame, by: number): Frame {
  const data = new Uint8Array(frame.data);
  for (let offset = 0; offset < data.length; offset += 4 * 64) {
    data[offset] = Math.min(255, (data[offset] ?? 0) + by);
  }
  return createFrame(frame.width, frame.height, data);
}

const reader = (frames: Record<string, Frame>) => (name: string) => {
  const frame = frames[name];
  if (frame === undefined) {
    throw new Error(`read of an absent baseline ${name}`);
  }
  return frame;
};

test("a case name joins the story id, the theme and the density", () => {
  assert.equal(
    visualName("controls-button--primary", "light", "compact"),
    "controls-button--primary--light--compact",
  );
  assert.throws(() => visualName("Controls Button", "dark", "comfortable"), /kebab/);
});

test("every story gets both themes and both densities, sorted and without exclusions", () => {
  const cases = visualCases(["b--one", "a--two", "b--one", "c--skip"], new Set(["c--skip"]));
  assert.deepEqual(
    cases.map((item) => item.name),
    [
      "a--two--dark--comfortable",
      "a--two--dark--compact",
      "a--two--light--comfortable",
      "a--two--light--compact",
      "b--one--dark--comfortable",
      "b--one--dark--compact",
      "b--one--light--comfortable",
      "b--one--light--compact",
    ],
  );
});

test("a compact case falls back to the comfortable baseline of its theme", () => {
  const compact = visualCase("a--two", "dark", "compact");
  assert.equal(compact.fallback, "a--two--dark--comfortable");
  assert.equal(baselineFor(compact, new Set(["a--two--dark--comfortable"])), compact.fallback);
  assert.equal(
    baselineFor(compact, new Set(["a--two--dark--comfortable", compact.name])),
    compact.name,
  );
  assert.equal(baselineFor(compact, new Set(["a--two--light--comfortable"])), null);
  const comfortable = visualCase("a--two", "dark", "comfortable");
  assert.equal(comfortable.fallback, null);
  assert.equal(baselineFor(comfortable, new Set()), null);
});

test("baselines of removed or renamed stories are stale", () => {
  const cases = visualCases(["a--two"]);
  assert.deepEqual(
    staleBaselines(cases, new Set(["a--two--dark--comfortable", "gone--story--dark--compact"])),
    ["gone--story--dark--compact"],
  );
});

test("no committed baselines at all skips the check until the first approval", () => {
  assert.equal(isBootstrapping(new Set()), true);
  const judgement = judgeVisual({
    item: visualCase("a--two", "dark", "comfortable"),
    actual: page,
    existing: new Set(),
    readBaseline: reader({}),
    update: false,
  });
  assert.equal(judgement.status, "skipped");
});

test("an unchanged story matches and small anti-aliasing jitter is tolerated", () => {
  const item = visualCase("a--two", "dark", "comfortable");
  const existing = new Set([item.name]);
  const readBaseline = reader({ [item.name]: page });
  assert.equal(
    judgeVisual({ item, actual: copy(page), existing, readBaseline, update: false }).status,
    "matched",
  );
  assert.equal(
    judgeVisual({
      item,
      actual: jitter(page, UI_TOLERANCE.maxChannelDelta),
      existing,
      readBaseline,
      update: false,
    }).status,
    "matched",
  );
});

test("a changed border colour differs and the message says how to approve it", () => {
  const item = visualCase("a--two", "light", "comfortable");
  const judgement = judgeVisual({
    item,
    actual: withBorder(page, [255, 0, 0]),
    existing: new Set([item.name]),
    readBaseline: reader({ [item.name]: withBorder(page, [0, 0, 255]) }),
    update: false,
  });
  assert.equal(judgement.status, "differs");
  if (judgement.status !== "differs") return;
  assert.match(judgement.message, /a--two in light comfortable does not match/);
  assert.match(judgement.message, /update_goldens=true/);
  assert.ok(judgement.comparison.differingPixels >= 128);
});

test("a compact story that changed against the comfortable fallback differs", () => {
  const item = visualCase("a--two", "dark", "compact");
  const judgement = judgeVisual({
    item,
    actual: createFrame(64, 60),
    existing: new Set(["a--two--dark--comfortable"]),
    readBaseline: reader({ "a--two--dark--comfortable": page }),
    update: false,
  });
  assert.equal(judgement.status, "differs");
  if (judgement.status !== "differs") return;
  assert.equal(judgement.baseline, "a--two--dark--comfortable");
});

test("a new story without a baseline fails once others are committed", () => {
  const judgement = judgeVisual({
    item: visualCase("new--story", "dark", "comfortable"),
    actual: page,
    existing: new Set(["a--two--dark--comfortable"]),
    readBaseline: reader({}),
    update: false,
  });
  assert.equal(judgement.status, "missing");
});

test("an update writes comfortable baselines and compact ones only when they differ", () => {
  const comfortable = visualCase("a--two", "dark", "comfortable");
  const compact = visualCase("a--two", "dark", "compact");
  const none = new Set<string>();
  const readBaseline = reader({});
  assert.deepEqual(
    judgeVisual({ item: comfortable, actual: page, existing: none, readBaseline, update: true }),
    { status: "write", name: comfortable.name },
  );
  assert.deepEqual(
    judgeVisual({
      item: compact,
      actual: copy(page),
      comfortableActual: page,
      existing: new Set([compact.name]),
      readBaseline,
      update: true,
    }),
    { status: "same-as-comfortable", remove: compact.name },
  );
  assert.deepEqual(
    judgeVisual({
      item: compact,
      actual: copy(page),
      comfortableActual: page,
      existing: none,
      readBaseline,
      update: true,
    }),
    { status: "same-as-comfortable", remove: null },
  );
  assert.deepEqual(
    judgeVisual({
      item: compact,
      actual: withBorder(page, [255, 0, 0]),
      comfortableActual: page,
      existing: none,
      readBaseline,
      update: true,
    }),
    { status: "write", name: compact.name },
  );
});
