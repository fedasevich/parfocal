/// <reference lib="dom" />
import { statSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { call, field, idOf, researcherWorkspace, root, signIn, sql } from "./support.ts";

const fixture = `${root}packages/test-fixtures/synthetic/synthetic-jpeg.tiff`;
const slideLabels = ["tumor_001", "tumor_002", "tumor_003"];
const rounds = Number(process.env["PARFOCAL_MAIN_PATH_ROUNDS"] ?? 0);
const jumpTarget = { x: 512, y: 384, magnification: 10 };

declare global {
  interface Window {
    stageReadyAt?: number;
    decisionTimes: number[];
    __parfocal?: { jumpTo?: (target: typeof jumpTarget) => Promise<number> };
  }
}

test.use({ viewport: { width: 1440, height: 900 } });
test.skip(rounds === 0, "Set PARFOCAL_MAIN_PATH_ROUNDS to measure the main paths");

type Round = { open: number[]; fitted: number[]; jump: number[]; decision: number[] };

async function freshSample(
  page: Page,
): Promise<{ project: string; task: string; slides: string[] }> {
  const me = field(await call(page, "GET", "/api/me"), "user_id");
  const tenantId = researcherWorkspace(me);
  const switched = await call(page, "PUT", "/api/me/workspace", { tenant_id: tenantId });
  expect(switched.status, JSON.stringify(switched.json)).toBe(200);
  const sample = await call(page, "POST", "/api/projects/sample");
  expect(sample.status, JSON.stringify(sample.json)).toBe(201);
  const project = idOf(sample);
  const labels = slideLabels.map((label) => `'${label}'`).join(", ");
  const slides = sql(
    `UPDATE slides SET original_key = 'e2e/' || id || '/slide.tiff', ` +
      `file_bytes = ${statSync(fixture).size} ` +
      `WHERE project_id = '${project}' AND label IN (${labels}) RETURNING id`,
  )
    .split("\n")
    .filter((line) => /^[0-9a-f-]{36}$/.test(line));
  expect(slides).toHaveLength(slideLabels.length);
  const pinned = sql(
    `SELECT slide_id || '|' || result_set_id FROM review_task_slides ` +
      `WHERE project_id = '${project}' AND slide_id IN ('${slides.join("', '")}')`,
  )
    .split("\n")
    .map((line) => {
      const [slide_id, result_set_id] = line.split("|");
      return { slide_id, result_set_id };
    });
  const annotate = await call(page, "POST", `/api/projects/${project}/review-tasks`, {
    name: "Main path check",
    kind: "annotate",
    slide_ids: slides,
    result_sets: pinned,
    reviewer_ids: [me],
    split: "everyone",
    scope: { kind: "whole-slide" },
    blinded: false,
  });
  expect(annotate.status, JSON.stringify(annotate.json)).toBe(201);
  return { project, task: idOf(annotate), slides };
}

async function openSlide(page: Page, path: string) {
  await page.goto(path);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  const opened = await page.evaluate(() => window.stageReadyAt ?? Number.NaN);
  const fitted = Number(await stage.getAttribute("data-fitted-ms"));
  return { opened, fitted };
}

async function jump(page: Page): Promise<number> {
  return page.evaluate(async (target) => {
    const jumpTo = window.__parfocal?.jumpTo;
    if (jumpTo === undefined) throw new Error("The live stage gives no jumpTo");
    return jumpTo(target);
  }, jumpTarget);
}

async function decideEach(page: Page): Promise<number[]> {
  const objects = await page.getByTestId("ai-object").count();
  await page.keyboard.press("Shift+G");
  const guide = page.getByTestId("guided-check");
  await expect(guide).toHaveAttribute("data-current", /.+/);
  await page.evaluate(() => {
    const node = document.querySelector('[data-testid="guided-check"]');
    if (node === null) throw new Error("The guided check is not on screen");
    window.decisionTimes = [];
    let pressedAt: number | null = null;
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "d") pressedAt = event.timeStamp;
      },
      { capture: true },
    );
    new MutationObserver(() => {
      if (pressedAt === null) return;
      const started = pressedAt;
      pressedAt = null;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => window.decisionTimes.push(performance.now() - started)),
      );
    }).observe(node, { attributes: true, attributeFilter: ["data-current"] });
  });
  const decisions = Math.min(objects, 3) - 1;
  for (let index = 0; index < decisions; index++) {
    const before = await guide.getAttribute("data-current");
    await expect(async () => {
      await expect(page.getByTestId("travel-minimap")).toHaveCount(0);
      await page.keyboard.press("d");
      await expect(guide).not.toHaveAttribute("data-current", before ?? "", { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  }
  await expect.poll(() => page.evaluate(() => window.decisionTimes.length)).toBe(decisions);
  return page.evaluate(() => window.decisionTimes);
}

async function measureRound(page: Page): Promise<Round> {
  const { project, task, slides } = await freshSample(page);
  const round: Round = { open: [], fitted: [], jump: [], decision: [] };
  for (const slide of slides) {
    const { opened, fitted } = await openSlide(
      page,
      `/projects/${project}/slides/${slide}/live?task=${task}`,
    );
    round.open.push(opened);
    round.fitted.push(fitted);
    round.jump.push(await jump(page));
    round.decision.push(...(await decideEach(page)));
  }
  return round;
}

const nearestRank = (values: readonly number[], share: number) => {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * share) - 1)] ?? Number.NaN;
};

const median = (values: readonly number[]) => {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  const upper = ordered[middle] ?? Number.NaN;
  return ordered.length % 2 === 1 ? upper : ((ordered[middle - 1] ?? Number.NaN) + upper) / 2;
};

const summary = (values: readonly number[]) => ({
  runs: values.length,
  median: median(values),
  p95: nearestRank(values, 0.95),
  min: Math.min(...values),
  max: Math.max(...values),
});

test("open, jump and decision against the local stack after a real sign-in", async ({ page }) => {
  test.setTimeout(120_000 + rounds * 90_000);
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (window.stageReadyAt !== undefined) return;
      const stage = document.querySelector('[data-testid="slide-stage"]');
      if (stage?.getAttribute("data-state") === "ready") window.stageReadyAt = performance.now();
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-state"] });
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && ![404, 409].includes(response.status())) {
      console.log(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  await signIn(page, "/");
  const home: unknown = Reflect.get(
    (await call(page, "GET", "/api/me")).json ?? {},
    "active_tenant_id",
  );
  const samples: Round = { open: [], fitted: [], jump: [], decision: [] };
  for (let round = 0; round <= rounds; round++) {
    const measured = await measureRound(page);
    if (round === 0) continue;
    for (const key of Object.keys(samples) as (keyof Round)[]) samples[key].push(...measured[key]);
  }
  if (typeof home === "string") await call(page, "PUT", "/api/me/workspace", { tenant_id: home });
  const report = Object.fromEntries(
    Object.entries(samples).map(([key, values]) => [key, { ...summary(values), values }]),
  );
  console.log(JSON.stringify(report));
  for (const values of Object.values(samples)) expect(values.every(Number.isFinite)).toBe(true);
});
