import { statSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { call, field, idOf, root, sql } from "./support.ts";
import { researcherWorkspace } from "./workspaces.ts";

const fixture = `${root}packages/test-fixtures/synthetic/synthetic-jpeg.tiff`;
const slideLabels = ["CMU-1-Small-Region.svs", "CMU-1.ndpi", "Leica-1.scn"];
const jumpTarget = { x: 512, y: 384, magnification: 10 };

type PageNode = { getAttribute(name: string): string | null };
type ObserveOptions = { attributes: boolean; subtree?: boolean; attributeFilter: string[] };
type KeyEvent = { key: string; timeStamp: number };

declare const window: {
  stageReadyAt?: number;
  decisionTimes: number[];
  __parfocal?: { jumpTo?: (target: typeof jumpTarget) => Promise<number> };
  addEventListener(
    type: "keydown",
    listener: (event: KeyEvent) => void,
    options: { capture: boolean },
  ): void;
};
declare const document: PageNode & { querySelector(selector: string): PageNode | null };
declare const performance: { now(): number };
declare function requestAnimationFrame(callback: () => void): number;
declare class MutationObserver {
  constructor(callback: () => void);
  observe(target: PageNode, options: ObserveOptions): void;
}

export async function watchStageReady(page: Page): Promise<void> {
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (window.stageReadyAt !== undefined) return;
      const stage = document.querySelector('[data-testid="slide-stage"]');
      if (stage?.getAttribute("data-state") === "ready") window.stageReadyAt = performance.now();
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-state"] });
  });
}

export async function freshSample(
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

export async function openSlide(page: Page, path: string) {
  await page.goto(path);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  const opened = await page.evaluate(() => window.stageReadyAt ?? Number.NaN);
  const fitted = Number(await stage.getAttribute("data-fitted-ms"));
  return { opened, fitted };
}

export async function jump(page: Page): Promise<number> {
  return page.evaluate(async (target) => {
    const jumpTo = window.__parfocal?.jumpTo;
    if (jumpTo === undefined) throw new Error("The live stage gives no jumpTo");
    return jumpTo(target);
  }, jumpTarget);
}

export async function decideEach(page: Page): Promise<number[]> {
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
