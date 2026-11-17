import { expect, type Page, test } from "@playwright/test";
import { decideEach, freshSample, jump, openSlide, watchStageReady } from "./main-path-steps.ts";
import { call, signIn } from "./support.ts";

const rounds = Number(process.env["PARFOCAL_MAIN_PATH_ROUNDS"] ?? 0);

test.use({ viewport: { width: 1440, height: 900 }, video: "off" });
test.skip(rounds === 0, "Set PARFOCAL_MAIN_PATH_ROUNDS to measure the main paths");

type Round = { open: number[]; fitted: number[]; jump: number[]; decision: number[] };

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
  await watchStageReady(page);
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
