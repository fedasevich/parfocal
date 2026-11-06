import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { boxRects, grid, laneRects, mapLayout } from "../src/flow-map/geometry.ts";
import { createOriginStore, originStorageKey, parseOrigin } from "../src/flow-map/origin.ts";
import { boxes, lanes, personaRoles } from "../src/flow-map/review-flow.ts";
import {
  chapters,
  nextStep,
  previousStep,
  stepCount,
  stepRole,
  stepWho,
} from "../src/flow-map/walkthrough.ts";
import { mockScenes } from "../src/screens/scenes.ts";

const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("the map has the mock's four lanes and twenty-one boxes with unique ids", () => {
  assert.deepEqual(
    lanes.map((lane) => lane.role),
    ["Researcher", "Reviewer", "Adjudicator", "Clinical project only"],
  );
  assert.equal(boxes.length, 21);
  assert.equal(new Set(boxes.map((box) => box.id)).size, boxes.length);
});

test("lanes stack with the mock's bands and fit the 1440 by 900 frame", () => {
  const rects = laneRects();
  assert.deepEqual(rects.res, { y: 82, h: 124, boxesTop: 116 });
  assert.equal(rects.rev.y, rects.res.y + rects.res.h + grid.band);
  assert.equal(rects.cli.y, rects.adj.y + rects.adj.h + 14);
  assert.ok(rects.cli.y + rects.cli.h <= grid.height);
});

test("no two boxes overlap and every box sits inside its lane and the frame", () => {
  const rects = laneRects();
  const all = boxRects(rects);
  const list = boxes.map((box) => ({ box, rect: all[box.id] }));
  for (const { box, rect } of list) {
    assert.ok(rect, box.id);
    const lane = rects[box.lane];
    assert.ok(rect.y >= lane.boxesTop && rect.b <= lane.y + lane.h, `${box.id} is inside its lane`);
    assert.ok(rect.x >= 24 && rect.r <= grid.width - 24, `${box.id} is inside the frame`);
  }
  for (const [index, a] of list.entries()) {
    for (const b of list.slice(index + 1)) {
      assert.ok(a.rect && b.rect && !overlaps(a.rect, b.rect), `${a.box.id} and ${b.box.id}`);
    }
  }
});

test("every box opens a scene its screen has in the inventory", () => {
  for (const box of boxes) {
    if (box.screen === "next" || box.screen === "worklist") continue;
    const known: readonly string[] = mockScenes[box.screen];
    assert.ok(box.scene && known.includes(box.scene), `${box.id} opens ${box.screen}/${box.scene}`);
  }
});

test("the hand-offs carry the mock's six labels and every arrow has a path", () => {
  const layout = mapLayout();
  assert.deepEqual(
    layout.pills.map((pill) => pill.label),
    [
      "Task sent",
      "Submitted",
      "Decided",
      "Sent to the adjudicator",
      "Signed off",
      "Sent for co-sign",
    ],
  );
  const hands = layout.arrows.filter((arrow) => arrow.kind === "hand");
  assert.equal(hands.length, 5);
  assert.equal(layout.arrows.filter((arrow) => arrow.kind === "wait").length, 1);
  for (const arrow of layout.arrows) {
    assert.match(arrow.d, /^M[\d.]+ [\d.]+( [HVL][\d.]+)+$/);
    for (const head of arrow.heads) {
      assert.ok(head.x >= 0 && head.x <= grid.width && head.y >= 0 && head.y <= grid.height);
    }
  }
});

test("the walkthrough has the mock's nine chapters and sixty-three steps", () => {
  assert.equal(chapters.length, 9);
  assert.deepEqual(
    chapters.map((chapter) => chapter.steps.length),
    [7, 2, 6, 2, 14, 8, 5, 5, 14],
  );
  assert.equal(stepCount, 63);
  for (const chapter of chapters) {
    for (const step of chapter.steps) {
      if (step.scene === undefined || !(step.screen in mockScenes)) continue;
      const known: readonly string[] = mockScenes[step.screen as keyof typeof mockScenes];
      assert.ok(known.includes(step.scene), `${chapter.title}: ${step.screen}/${step.scene}`);
    }
  }
});

test("steps move across chapter edges and stop at both ends", () => {
  assert.deepEqual(nextStep({ chapter: 0, step: 6 }), { chapter: 1, step: 0 });
  assert.deepEqual(previousStep({ chapter: 1, step: 0 }), { chapter: 0, step: 6 });
  assert.equal(previousStep({ chapter: 0, step: 0 }), null);
  assert.equal(nextStep({ chapter: 8, step: 13 }), null);
});

test("the persona follows the step, with Tomáš on the co-sign path", () => {
  assert.equal(stepWho({ chapter: 6, step: 0 }), "AK");
  assert.equal(stepWho({ chapter: 8, step: 9 }), "TB");
  assert.equal(stepRole({ chapter: 8, step: 9 }, personaRoles), "pathologist");
  assert.equal(stepRole({ chapter: 8, step: 0 }, personaRoles), "pathologist");
  assert.equal(stepRole({ chapter: 4, step: 0 }, personaRoles), "reviewer");
});

test("the origin survives a reload through session storage and ignores junk", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
  const ids = {
    researchProject: "p07",
    clinicalProject: "p03",
    task: "rt14",
    slide: "a1",
    clinicalSlide: "c1",
    clinicalCase: "k1",
  };
  const store = createOriginStore(storage);
  let calls = 0;
  const stop = store.subscribe(() => {
    calls += 1;
  });
  store.set({ kind: "map", box: "team", ids });
  assert.deepEqual(createOriginStore(storage).get(), { kind: "map", box: "team", ids });
  store.set(null);
  assert.equal(values.has(originStorageKey), false);
  stop();
  store.set({ kind: "walk", chapter: 1, step: 0, ids });
  assert.equal(calls, 2);
  assert.equal(parseOrigin("{"), null);
  assert.equal(parseOrigin(JSON.stringify({ kind: "walk", chapter: -1, step: 0, ids })), null);
  assert.equal(parseOrigin(JSON.stringify({ kind: "map", box: "team" })), null);
  assert.equal(createOriginStore(undefined).get(), null);
});

test("the scene lists match the PROTO-001 inventory", () => {
  const inventory = readFileSync(
    new URL("../../../docs/design/prototype-inventory.md", import.meta.url),
    "utf8",
  );
  for (const [screen, scenes] of Object.entries(mockScenes)) {
    const row = inventory.split("\n").find((line) => line.startsWith(`| \`${screen}\` |`));
    assert.ok(row, `the inventory lists ${screen}`);
    const cell = row.split("|")[3] ?? "";
    assert.deepEqual(
      [...cell.matchAll(/`(\w+)`/g)].map((match) => match[1]),
      [...scenes],
      screen,
    );
  }
});
