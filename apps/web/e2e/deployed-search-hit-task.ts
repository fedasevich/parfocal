import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Page } from "@playwright/test";

const USAGE = [
  "Usage: node e2e/deployed-search-hit-task.ts [--base URL] [--state STORAGE_STATE.json]",
  "Opens a drawn hit in the drawn outline review and a cell hit in the annotation example,",
  "both with ?task=…&object=…, and checks the camera centre, a zoom above the fit and the pick.",
].join("\n");

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "https://app.parfocal.eu" },
    state: { type: "string", default: join(homedir(), ".config/parfocal/agent-session.json") },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const drawnTaskName = "Drawn outline review example";
const annotateTaskName = "Annotation example";
const annotateCell = "C1";
const reach = 2;
const aboveFit = 1;
const waitMs = 30_000;
const pickWaitMs = 120_000;

type Camera = { x: number; y: number; zoom: number };
type Point = { x: number; y: number };
type Case = {
  name: string;
  slideUrl: string;
  object: string;
  centre: Point;
  picked: (page: Page) => Promise<boolean>;
};

async function api<T>(page: Page, path: string): Promise<T> {
  const body: unknown = await page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    const parsed: unknown = await response.json();
    return parsed;
  }, path);
  return body as T;
}

function boxCentre(points: readonly (readonly number[])[]): Point {
  const xs = points.map((point) => point[0] ?? 0);
  const ys = points.map((point) => point[1] ?? 0);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

function pairs(flat: readonly number[]): number[][] {
  const out: number[][] = [];
  for (let index = 0; index + 1 < flat.length; index += 2) {
    out.push([flat[index] ?? 0, flat[index + 1] ?? 0]);
  }
  return out;
}

async function cameraOf(page: Page): Promise<Camera | null> {
  const text = await page.getByTestId("slide-host").getAttribute("data-camera");
  const [x, y, zoom] = (text ?? "").split(",").map(Number);
  if (x === undefined || y === undefined || zoom === undefined) return null;
  return [x, y, zoom].some(Number.isNaN) ? null : { x, y, zoom };
}

async function settledCamera(page: Page): Promise<Camera | null> {
  const until = Date.now() + waitMs;
  let before = "";
  while (Date.now() < until) {
    const camera = await cameraOf(page);
    const now = JSON.stringify(camera);
    if (camera !== null && now === before) return camera;
    before = now;
    await page.waitForTimeout(500);
  }
  return cameraOf(page);
}

async function openStage(page: Page, url: string) {
  await page.goto(url);
  await page
    .locator('[data-testid="slide-stage"][data-state="ready"]')
    .waitFor({ timeout: waitMs });
}

async function findTask(page: Page, name: string) {
  const projects = await api<{ id: string }[]>(page, "/api/projects");
  for (const project of projects) {
    const tasks = await api<{ id: string; name: string }[]>(
      page,
      `/api/projects/${project.id}/review-tasks`,
    );
    const task = tasks.find((item) => item.name === name);
    if (task !== undefined) {
      const detail = await api<{ slides: { slide_id: string }[] }>(
        page,
        `/api/review-tasks/${task.id}`,
      );
      return {
        projectId: project.id,
        taskId: task.id,
        slideIds: detail.slides.map((s) => s.slide_id),
      };
    }
  }
  throw new Error(`no task named ${name}`);
}

async function drawnCase(page: Page): Promise<Case> {
  const { projectId, taskId, slideIds } = await findTask(page, drawnTaskName);
  for (const slideId of slideIds) {
    const listed = await api<{
      objects: { object: string; drawn?: boolean; outline: number[] | null }[];
    }>(page, `/api/review-tasks/${taskId}/slides/${slideId}/objects`);
    const drawn = listed.objects.find((item) => item.drawn === true && item.outline !== null);
    if (drawn?.outline == null) continue;
    return {
      name: `drawn ${drawn.object}+ in "${drawnTaskName}"`,
      slideUrl: `/projects/${projectId}/slides/${slideId}?task=${taskId}`,
      object: `${drawn.object}%2B`,
      centre: boxCentre(pairs(drawn.outline)),
      picked: async (shown) =>
        (await shown.getByTestId("stage-review-objects").getAttribute("data-current")) ===
        drawn.object,
    };
  }
  throw new Error(`no drawn object in ${drawnTaskName}`);
}

async function annotateCase(page: Page): Promise<Case> {
  const { projectId, taskId, slideIds } = await findTask(page, annotateTaskName);
  for (const slideId of slideIds) {
    const listed = await api<{
      objects: { object: string; geometry: { coordinates: number[][][] } }[];
    }>(page, `/api/review-tasks/${taskId}/slides/${slideId}/shared-layer/ai?limit=5000`);
    const cell = listed.objects.find((item) => item.object === annotateCell);
    const ring = cell?.geometry.coordinates[0];
    if (ring === undefined) continue;
    return {
      name: `cell ${annotateCell} in "${annotateTaskName}"`,
      slideUrl: `/projects/${projectId}/slides/${slideId}?task=${taskId}`,
      object: annotateCell,
      centre: boxCentre(ring),
      picked: async (shown) =>
        (await shown
          .locator(`[data-testid="ai-object"][data-object="${annotateCell}"]`)
          .first()
          .getAttribute("data-selected", { timeout: 1_000 })
          .catch(() => null)) === "true",
    };
  }
  throw new Error(`no ${annotateCell} in ${annotateTaskName}`);
}

async function pickedWithin(page: Page, item: Case): Promise<boolean> {
  const until = Date.now() + pickWaitMs;
  while (Date.now() < until) {
    if (await item.picked(page).catch(() => false)) return true;
    await page.waitForTimeout(500);
  }
  return item.picked(page).catch(() => false);
}

async function landedCamera(page: Page, item: Case, fit: Camera | null): Promise<Camera | null> {
  const until = Date.now() + waitMs;
  let camera = await cameraOf(page);
  while (Date.now() < until) {
    const near =
      camera !== null && Math.hypot(camera.x - item.centre.x, camera.y - item.centre.y) < reach;
    if (near && fit !== null && camera !== null && camera.zoom > fit.zoom + aboveFit) break;
    await page.waitForTimeout(500);
    camera = await cameraOf(page);
  }
  return settledCamera(page);
}

async function check(page: Page, item: Case): Promise<boolean> {
  await openStage(page, item.slideUrl);
  const fit = await settledCamera(page);
  await openStage(page, `${item.slideUrl}&object=${item.object}`);
  const picked = await pickedWithin(page, item);
  const landed = await landedCamera(page, item, fit);
  const offset =
    landed === null ? Infinity : Math.hypot(landed.x - item.centre.x, landed.y - item.centre.y);
  const zoomed = landed !== null && fit !== null && landed.zoom > fit.zoom + aboveFit;
  const ok = offset < reach && zoomed && picked;
  console.log(
    [
      ok ? "PASS" : "FAIL",
      item.name,
      `offset ${offset.toFixed(2)} px`,
      `zoom ${landed?.zoom.toFixed(2)} against fit ${fit?.zoom.toFixed(2)}`,
      `picked ${picked}`,
    ].join(" · "),
  );
  return ok;
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    baseURL: values.base,
    storageState: values.state,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("/");
  const cases = [await drawnCase(page), await annotateCase(page)];
  const results: boolean[] = [];
  for (const item of cases) results.push(await check(page, item));
  process.exitCode = results.every(Boolean) ? 0 : 1;
} finally {
  await browser.close();
}
