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

test("a model run on a drawn selection streams onto the slide, joins the task and is fixed", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stage = await openByHandSlide(page);
  await expect(page.getByTestId("no-result-set")).toBeVisible();
  const panel = page.getByTestId("annotate-run");
  await expect(page.getByTestId("annotate-run-selection")).toBeDisabled();

  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("p");
  for (const [x, y] of corners) await page.mouse.click(box.x + x, box.y + y);
  await page.mouse.click(box.x + corners[0][0] + 2, box.y + corners[0][1] + 1);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(1);
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  await page.keyboard.press("Escape");
  await page.mouse.click(box.x + 640, box.y + 360);
  await expect(page.getByTestId("annotate-run-selection")).toBeEnabled();

  const posted = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith(`/model-runs`),
  );
  await page.getByTestId("annotate-run-selection").click();
  const draft = (await posted).postDataJSON() as {
    task_id: string;
    slide_ids: string[];
    scope: { kind: string; geometry: { type: string; coordinates: number[][][] } };
  };
  expect(draft.task_id).toBe(annotateTask);
  expect(draft.slide_ids).toEqual([byHand]);
  expect(draft.scope.kind).toBe("selection");
  expect(draft.scope.geometry.type).toBe("Polygon");
  expect(draft.scope.geometry.coordinates[0]).toHaveLength(corners.length + 1);

  await expect(page.getByTestId("run-stream")).toHaveAttribute("data-status", "running", {
    timeout: 15_000,
  });
  await expect(panel).toHaveAttribute("data-phase", "joined", { timeout: 30_000 });
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
  const posted = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith(`/model-runs`),
  );
  await page.getByTestId("annotate-run-view").click();
  const draft = (await posted).postDataJSON() as {
    task_id: string;
    scope: { kind: string; x: number; y: number; width: number; height: number };
  };
  expect(draft.task_id).toBe(annotateTask);
  expect(draft.scope.kind).toBe("view");
  expect(draft.scope.width).toBeGreaterThan(0);
  expect(draft.scope.height).toBeGreaterThan(0);
  await expect(page.getByTestId("annotate-run")).toHaveAttribute("data-phase", "running");
});
