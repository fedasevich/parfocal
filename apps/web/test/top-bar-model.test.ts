import assert from "node:assert/strict";
import { test } from "node:test";
import { slidePickerSummary, topBarMoreItems } from "../src/screens/review/top-bar-model.ts";

const base = { projectId: "p1", slideId: "s1", taskId: "t1" };

test("the slide picker summary reads case, n of N and the result set count", () => {
  assert.equal(
    slidePickerSummary({ caseLabel: "A1", position: 2, total: 5, resultSets: 3 }),
    "Case A1 · 2 of 5 · 3 result sets",
  );
  assert.equal(
    slidePickerSummary({ caseLabel: null, position: undefined, total: undefined, resultSets: 1 }),
    "1 result set",
  );
});

test("the more menu lists share, add a result set, run a model, compare, focus, shortcuts and settings", () => {
  const items = topBarMoreItems({ ...base, mode: "full", go: () => undefined });
  assert.deepEqual(
    items.map((item) => item.label),
    [
      "Share this view",
      "Add a result set",
      "Run a model",
      "Compare with another slide",
      "Focus mode",
      "Keyboard shortcuts",
      "Settings",
    ],
  );
});

test("each more item opens its destination and the annotate menu adds a second opinion", () => {
  const visited: string[] = [];
  const items = topBarMoreItems({ ...base, mode: "annotate", go: (href) => visited.push(href) });
  for (const item of items) item.onSelect?.();
  assert.equal(visited.length, items.length - 1);
  assert.ok(visited.includes("/projects/p1/run-model"));
  assert.ok(visited.includes("/settings/shortcuts"));
  assert.ok(visited.includes("/tasks/t1/comments"));
  assert.ok(visited.some((href) => href.includes("scene=picking")));
});

test("project destinations do nothing before the project is known", () => {
  const visited: string[] = [];
  const items = topBarMoreItems({
    ...base,
    projectId: "",
    mode: "full",
    go: (href) => visited.push(href),
  });
  for (const item of items) item.onSelect?.();
  assert.deepEqual(visited, ["/settings/shortcuts", "/settings/display"]);
});
