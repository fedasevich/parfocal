import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { expect, type Page, type Request, test } from "@playwright/test";
import { decideEach, freshSample, jump, openSlide, watchStageReady } from "./main-path-steps.ts";
import { call, root, signIn, sql } from "./support.ts";

const rounds = Number(process.env["PARFOCAL_SESSION_ROUNDS"] ?? 0);
const idleSeconds = Number(process.env["PARFOCAL_SESSION_IDLE_SECONDS"] ?? 60);
const output = process.env["PARFOCAL_SESSION_LOG"] ?? `${root}apps/e2e/test-results/session.json`;

test.use({ viewport: { width: 1440, height: 900 } });
test.skip(rounds === 0, "Set PARFOCAL_SESSION_ROUNDS to record a busy session's API requests");

type Recorded = { at: number; method: string; route: string; status: number; step: string };

const routeOf = (url: string) =>
  new URL(url).pathname.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
    "{id}",
  );

async function panAround(page: Page) {
  const stage = page.getByTestId("slide-stage");
  const box = await stage.boundingBox();
  if (box === null) throw new Error("The slide stage has no box");
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  for (const [dx, dy] of [
    [300, 0],
    [0, 200],
    [-300, 0],
    [0, -200],
  ] as const) {
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + dx, centre.y + dy, { steps: 20 });
    await page.mouse.up();
  }
  for (const delta of [-400, -400, 400, 400]) {
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(250);
  }
}

test("record the API requests of a busy viewer session", async ({ page }) => {
  test.setTimeout(180_000 + idleSeconds * 1000 + rounds * 120_000);
  await watchStageReady(page);
  const started = Date.now();
  let step = "sign-in";
  const recorded: Recorded[] = [];
  const pending = new Map<Request, Recorded>();
  page.context().on("request", (request) => {
    if (!new URL(request.url()).pathname.startsWith("/api/")) return;
    const entry = {
      at: Date.now() - started,
      method: request.method(),
      route: routeOf(request.url()),
      status: 0,
      step,
    };
    recorded.push(entry);
    pending.set(request, entry);
  });
  page.context().on("response", (response) => {
    const entry = pending.get(response.request());
    if (entry !== undefined) entry.status = response.status();
  });
  await signIn(page, "/");
  const me = String(Reflect.get((await call(page, "GET", "/api/me")).json ?? {}, "user_id"));
  const home: unknown = Reflect.get(
    (await call(page, "GET", "/api/me")).json ?? {},
    "active_tenant_id",
  );
  for (let round = 0; round < rounds; round++) {
    step = "setup";
    const { project, task, slides } = await freshSample(page);
    for (const slide of slides) {
      step = "open";
      await openSlide(page, `/projects/${project}/slides/${slide}/live?task=${task}`);
      step = "jump";
      await jump(page);
      step = "pan";
      await panAround(page);
      step = "decide";
      await decideEach(page);
      if (round === 0 && slide === slides[0]) {
        step = "idle";
        await page.waitForTimeout(idleSeconds * 1000);
      }
    }
  }
  step = "teardown";
  if (typeof home === "string") await call(page, "PUT", "/api/me/workspace", { tenant_id: home });
  const counters = sql(
    `SELECT window_start || '|' || count FROM rate_counters WHERE key = 'user:${me}' ` +
      "ORDER BY window_start",
  )
    .split("\n")
    .filter((line) => line.includes("|"))
    .map((line) => {
      const [window, count] = line.split("|");
      return { window, count: Number(count) };
    });
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify({ rounds, idleSeconds, counters, recorded }, null, 1));
  expect(recorded.length).toBeGreaterThan(0);
});
