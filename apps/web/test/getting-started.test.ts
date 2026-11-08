import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checklistShows,
  createTriedStore,
  type Step,
  stepsWithTried,
  stepTarget,
} from "../src/screens/home/getting-started.ts";

const steps: Step[] = [
  { key: "confirm-email", label: "Confirm your email", done: true },
  { key: "open-sample", label: "Open the sample project", done: true },
  { key: "guided-review", label: "Review one slide in guided review", done: false },
  { key: "comment", label: "Comment on an object ID", done: false },
  { key: "opinion", label: "Submit your first opinion form", done: false },
];

const doneKeys = (list: Step[]) => list.filter((step) => step.done).map((step) => step.key);

test("a step ticks when the matching real action happens", () => {
  const store = createTriedStore();
  assert.deepEqual(doneKeys(stepsWithTried(steps, store.snapshot())), [
    "confirm-email",
    "open-sample",
  ]);
  store.mark("guided-review");
  assert.deepEqual(doneKeys(stepsWithTried(steps, store.snapshot())), [
    "confirm-email",
    "open-sample",
    "guided-review",
  ]);
  store.mark("comment");
  store.mark("opinion");
  assert.equal(
    stepsWithTried(steps, store.snapshot()).every((step) => step.done),
    true,
  );
});

test("the store tells listeners once per new step and stops after unsubscribe", () => {
  const store = createTriedStore();
  let calls = 0;
  const stop = store.subscribe(() => {
    calls += 1;
  });
  store.mark("comment");
  store.mark("comment");
  assert.equal(calls, 1);
  stop();
  store.mark("opinion");
  assert.equal(calls, 1);
});

test("a step the server already counts stays ticked and the input list is not changed", () => {
  const ticked = stepsWithTried(steps, new Set(["confirm-email"]));
  assert.equal(ticked[0]?.done, true);
  assert.equal(steps[2]?.done, false);
});

test("the checklist shows until every step is tried or the person hides it", () => {
  const base = { serverHidden: false, personalHidden: false, steps };
  assert.equal(checklistShows(base), true);
  assert.equal(checklistShows({ ...base, personalHidden: true }), false);
  assert.equal(checklistShows({ ...base, serverHidden: true }), false);
  assert.equal(
    checklistShows({ ...base, steps: steps.map((step) => ({ ...step, done: true })) }),
    false,
  );
  assert.equal(checklistShows({ ...base, steps: [] }), false);
});

test("the review steps lead to the guided review of the sample and the early ones go nowhere", () => {
  assert.match(stepTarget("guided-review") ?? "", /guided/);
  assert.equal(stepTarget("comment"), stepTarget("opinion"));
  assert.equal(stepTarget("confirm-email"), undefined);
});
