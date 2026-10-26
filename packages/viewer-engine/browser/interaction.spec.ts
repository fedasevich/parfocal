import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { defaultRestMs } from "../src/index.ts";
import { harnessUrl } from "./cdp.ts";
import type {
  InteractionRunOptions,
  InteractionRunReport,
  PauseMode,
} from "./page/interaction-harness.ts";

const runsPerMode = 3;
const reportDir = fileURLToPath(new URL("../test-results/interaction-reports", import.meta.url));

const shared: Omit<InteractionRunOptions, "mode"> = {
  panMs: 3000,
  sliceMs: 40,
  regions: 1000,
  warmupMs: 120,
  settlePanMs: 500,
  panStepPx: 2,
};

const modes: readonly PauseMode[] = ["no-job", "unpaused", "paused"];

test.describe.configure({ mode: "serial", timeout: 120_000 });

const reports: Record<PauseMode, InteractionRunReport[]> = {
  "no-job": [],
  unpaused: [],
  paused: [],
};

let chromeVersion = "";

test.beforeAll(({ browser }) => {
  chromeVersion = browser.version();
});

for (const mode of modes) {
  test(`a pan with ${mode === "no-job" ? "no background job" : `a busy stand-in region pass, ${mode}`}`, async ({
    page,
  }) => {
    for (let run = 0; run < runsPerMode; run++) {
      console.log(`${mode} run ${run} starts at ${new Date().toISOString()}`);
      await page.goto(harnessUrl("/app/interaction.html"));
      await page.waitForFunction(() => window.interactionHarness !== undefined);
      reports[mode].push(
        await page.evaluate((options) => window.interactionHarness.run(options), {
          ...shared,
          mode,
        }),
      );
    }
    const mean = (pick: (report: InteractionRunReport) => number) =>
      reports[mode].reduce((sum, report) => sum + pick(report), 0) / reports[mode].length;
    console.log(
      `${mode}: fps ${reports[mode].map((report) => report.fps.toFixed(1)).join(", ")}, p95 ${reports[
        mode
      ]
        .map((report) => report.frameMs.p95.toFixed(1))
        .join(", ")} ms, worst ${reports[mode]
        .map((report) => report.frameMs.worst.toFixed(1))
        .join(
          ", ",
        )} ms, over 33 ms ${reports[mode].map((report) => report.framesOver33Ms).join(", ")}, regions during pan ${reports[
        mode
      ]
        .map((report) => report.regionsDuringPan)
        .join(", ")}, mean fps ${mean((report) => report.fps).toFixed(1)}`,
    );
  });
}

test.afterAll(() => {
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(
    join(reportDir, "interaction-pause.json"),
    `${JSON.stringify({ chromeVersion, options: shared, restMs: defaultRestMs, reports }, null, 2)}\n`,
  );
});

test("the paused job keeps the pan at 60 fps, the unpaused one does not, and the job resumes after rest", () => {
  const baseline = reports["no-job"];
  const paused = reports.paused;
  const unpaused = reports.unpaused;
  expect(baseline.length).toBe(runsPerMode);
  for (const report of baseline) expect(report.fps).toBeGreaterThan(55);
  for (const report of unpaused) {
    expect(report.fps, "the stand-in job must compete for the main thread").toBeLessThan(45);
  }
  for (const report of paused) {
    expect(report.fps).toBeGreaterThan(55);
    expect(report.framesOver33Ms).toBeLessThanOrEqual(1);
    expect(report.regionsDuringPan).toBeLessThanOrEqual(1);
    expect(report.resumeDelayMs).not.toBeNull();
    expect(report.resumeDelayMs ?? 0).toBeGreaterThanOrEqual(defaultRestMs);
    expect(report.resumeDelayMs ?? 0).toBeLessThan(defaultRestMs + shared.sliceMs + 150);
  }
});
