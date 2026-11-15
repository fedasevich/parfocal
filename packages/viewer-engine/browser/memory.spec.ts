import { expect, test } from "@playwright/test";
import { defaultCycle, growth, runSwitches, summary } from "./memory-run.ts";

const warmUpVisits = defaultCycle.length;
const defaultSwitches = 20;
const heapBudget = 0.1;

test("20 slide switches after a warm-up pass keep one Deck and the heap within 10% of baseline", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const run = await runSwitches(page, { release: "wrapper", switches: defaultSwitches });
  console.log(summary(run));
  expect(run.samples.map((sample) => sample.report.loadTimeouts)).toEqual(run.samples.map(() => 0));
  expect(run.samples.map((sample) => sample.decks)).toEqual(run.samples.map(() => 1));
  expect(run.samples.map((sample) => sample.canvasContexts)).toEqual(run.samples.map(() => 1));
  expect(run.samples.map((sample) => sample.report.canvases)).toEqual(run.samples.map(() => 1));
  expect(growth(run)).toBeLessThanOrEqual(heapBudget);
  expect(run.closed).toMatchObject({ decks: 0, devices: 0, canvasContexts: 0, canvases: 0 });
  expect(run.contexts.lost).toBe(run.contexts.created);
});

test("without canvasContext.destroy every old Deck stays alive, so the wrapper is still needed", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const run = await runSwitches(page, { release: "no-canvas-context", switches: defaultSwitches });
  console.log(summary(run));
  const last = run.samples.at(-1);
  expect(
    last?.decks,
    "deck.gl or luma.gl now releases finalized decks without canvasContext.destroy(). Rerun the STACK-015 test and drop the wrapper as ADR 0098 says",
  ).toBe(warmUpVisits + defaultSwitches + 1);
  expect(growth(run)).toBeGreaterThan(heapBudget);
});

test("four viewers open at once keep four Decks and the heap within 10% of baseline", async ({
  page,
}) => {
  test.setTimeout(600_000);
  const viewers = 4;
  const run = await runSwitches(page, { release: "wrapper", viewers, switches: 8 });
  console.log(summary(run));
  expect(run.samples.map((sample) => sample.report.loadTimeouts)).toEqual(run.samples.map(() => 0));
  expect(run.samples.map((sample) => sample.decks)).toEqual(run.samples.map(() => viewers));
  expect(run.samples.map((sample) => sample.canvasContexts)).toEqual(
    run.samples.map(() => viewers),
  );
  expect(run.samples.map((sample) => sample.report.canvases)).toEqual(
    run.samples.map(() => viewers),
  );
  expect(growth(run)).toBeLessThanOrEqual(heapBudget);
  expect(run.closed).toMatchObject({ decks: 0, devices: 0, canvasContexts: 0, canvases: 0 });
  expect(run.contexts.lost).toBe(run.contexts.created);
});
