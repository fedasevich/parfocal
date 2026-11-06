import assert from "node:assert/strict";
import { test } from "node:test";
import { builtScreens, isScreenBuilt, pendingTask } from "../src/flow-map/built-screens.ts";
import { issueGroups, issueStateCount, issueTarget } from "../src/flow-map/issue-states.ts";
import { isBuilt } from "../src/flow-map/review-flow.ts";

const ids = {
  researchProject: "p07",
  clinicalProject: "p03",
  task: "rt14",
  slide: "a1",
  clinicalSlide: "c1",
  clinicalCase: "k1",
};

const screensOf = () =>
  issueGroups.flatMap((group) =>
    group.rows.flatMap((row) => [
      { screen: row.screen, scene: row.scene },
      ...(row.also ? [{ screen: row.also, scene: row.scene }] : []),
    ]),
  );

test("the index lists the mock's 45 states in 15 flows", () => {
  assert.equal(issueGroups.length, 15);
  assert.equal(issueStateCount, 45);
  const keys = issueGroups.flatMap((group) =>
    group.rows.map((row) => `${row.screen}:${row.scene}`),
  );
  assert.equal(new Set(keys).size, keys.length);
});

test("every built state opens its route with its own scene", () => {
  for (const { screen, scene } of screensOf()) {
    if (!isScreenBuilt(screen)) continue;
    const target = issueTarget(screen, scene, ids);
    assert.ok(target, `${screen}:${scene} has a target`);
    const search = target.search as Record<string, unknown>;
    assert.equal(search["scene"], scene, `${screen}:${scene} keeps its scene`);
  }
});

test("every screen that is not built names the task that builds it", () => {
  for (const { screen } of screensOf()) {
    if (isScreenBuilt(screen)) continue;
    assert.ok(pendingTask[screen], `${screen} names its task`);
  }
});

test("the flow map and the index read the same list of built screens", () => {
  assert.ok(builtScreens.has("guided"));
  assert.ok(builtScreens.has("case"));
  assert.ok(builtScreens.has("layers"));
  assert.equal(isBuilt({ screen: "creport" } as Parameters<typeof isBuilt>[0]), true);
  assert.equal(isBuilt({ screen: "disagree" } as Parameters<typeof isBuilt>[0]), true);
  assert.deepEqual(Object.keys(pendingTask), []);
});
