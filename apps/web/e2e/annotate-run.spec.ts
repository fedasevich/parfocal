import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const annotateTask = "00000000-0000-4000-8007-000000000021";
const byHand = "00000000-0000-4000-8005-000000000014";

test.use({ viewport: { width: 1440, height: 900 } });

async function openByHandSlide(page: Page) {
  await page.goto(
    `/projects/${p07}/slides/${byHand}/live?task=${annotateTask}&as=DH&scene=streaming`,
  );
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await expect(stage).toHaveAttribute("data-layer", "shared");
  return stage;
}

const corners = [
  [520, 250],
  [760, 260],
  [740, 470],
  [530, 450],
] as const;

const runPosted = (page: Page) =>
  page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith(`/model-runs`),
  );

test("a model run on a drawn selection streams onto the slide, joins the task and is fixed", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stage = await openByHandSlide(page);
  await expect(page.getByTestId("no-result-set")).toBeVisible();
  await expect(page.getByTestId("start-run")).toHaveCount(1);

  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("p");
  for (const [x, y] of corners) await page.mouse.click(box.x + x, box.y + y);
  await page.mouse.click(box.x + corners[0][0] + 2, box.y + corners[0][1] + 1);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(1);
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  await page.keyboard.press("Escape");
  await page.mouse.click(box.x + 640, box.y + 360);

  await page.getByTestId("start-run-options").click();
  await page.getByTestId("start-run-scope").selectOption("selection");
  const posted = runPosted(page);
  await page.getByTestId("start-run-find").click();
  const draft = (await posted).postDataJSON() as {
    task_id: string;
    slide_ids: string[];
    scope: { kind: string; geometry: { type: string; coordinates: number[][][] } };
  };
  expect(draft.task_id).toBe(annotateTask);
  expect(draft.slide_ids).toEqual([byHand]);
  expect(draft.scope.kind).toBe("selection");
  expect(draft.scope.geometry.type).toBe("Polygon");

  const streaming = page.getByTestId("run-stream");
  await expect(streaming).toHaveAttribute("data-status", "running", { timeout: 15_000 });
  await expect
    .poll(async () => Number(await streaming.getAttribute("data-drawn")), { timeout: 15_000 })
    .toBeGreaterThan(0);

  const joined = page.getByTestId("annotate-run");
  await expect(joined).toHaveAttribute("data-phase", "joined", { timeout: 30_000 });
  await expect(joined).toHaveAttribute("data-streamed", "0");
  await expect(streaming).toHaveCount(0);
  await expect(page.getByTestId("no-result-set")).toHaveCount(0);
  const objects = page.getByTestId("ai-object");
  await expect.poll(() => objects.count(), { timeout: 15_000 }).toBeGreaterThan(0);
  const before = await objects.count();

  const first = page.getByRole("button", { name: /^C\d+/ }).first();
  const name = ((await first.textContent()) ?? "").match(/^C\d+/)?.[0];
  if (name === undefined) throw new Error("No AI object listed");
  await first.click();
  await page.getByRole("button", { name: `Delete ${name}` }).click();
  await expect(page.getByRole("button", { name: new RegExp(`^${name}`) })).toHaveAttribute(
    "data-origin",
    "ai-edited",
  );
  await expect(objects).toHaveCount(before - 1);
});

test("a model run on the current view sends the view scope with the task", async ({ page }) => {
  await openByHandSlide(page);
  await page.getByTestId("start-run-options").click();
  await page.getByTestId("start-run-scope").selectOption("view");
  const posted = runPosted(page);
  await page.getByTestId("start-run-find").click();
  const draft = (await posted).postDataJSON() as {
    task_id: string;
    scope: { kind: string; width: number; height: number };
  };
  expect(draft.task_id).toBe(annotateTask);
  expect(draft.scope.kind).toBe("view");
  expect(draft.scope.width).toBeGreaterThan(0);
  expect(draft.scope.height).toBeGreaterThan(0);
  await expect(page.getByTestId("annotate-run")).toHaveAttribute("data-phase", "running");
});

test("an expert without the right to run models sees no run panel", async ({ page }) => {
  await page.goto(
    `/projects/${p07}/slides/${byHand}/live?task=${annotateTask}&as=AK&scene=streaming`,
  );
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await page.waitForTimeout(1000);
  await expect(page.getByTestId("start-run")).toHaveCount(0);
});
