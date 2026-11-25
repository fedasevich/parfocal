import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

test.use({ viewport: { width: 1440, height: 900 } });

const panel = (page: Page) => page.getByTestId("stage-review-objects");
const addRegion = (page: Page) =>
  panel(page).getByRole("button", { name: "Add a region the AI missed" });

async function openGuided(page: Page) {
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&mode=guided`);
  await expect(panel(page)).toHaveAttribute("data-ready", "true", { timeout: 25_000 });
  const start = page.getByRole("button", { name: "Got it, start" });
  if (await start.isVisible()) await start.click();
  await expect(panel(page)).toHaveAttribute("data-current", "T5");
}

const addedCodes = (page: Page) =>
  page.evaluate(
    async ([task, slide]) => {
      const layer = await fetch(`/api/review-tasks/${task}/slides/${slide}/layer`);
      return ((await layer.json()) as { added: { code: string }[] }).added.map((item) => item.code);
    },
    [rt14, a1] as const,
  );

async function drawSquare(page: Page) {
  const stage = page.getByTestId("slide-stage");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  const origin = { x: box.x + box.width / 2 - 60, y: box.y + box.height / 2 - 50 };
  for (const [x, y] of [
    [0, 0],
    [120, 10],
    [100, 100],
    [10, 90],
  ] as const) {
    await page.mouse.click(origin.x + x, origin.y + y);
  }
  await page.mouse.click(origin.x + 2, origin.y + 1);
}

test("a task with add what the AI missed draws the missed region and keeps it after a reload", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openGuided(page);
  await expect(addRegion(page)).toBeVisible();
  await expect(panel(page).getByText("Add something the AI missed")).toHaveCount(0);
  await addRegion(page).click();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-tool", "polygon");
  const saved = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith("/added"),
  );
  await drawSquare(page);
  await saved;
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-save-state", "saved");
  const codes = await addedCodes(page);
  expect(codes).toHaveLength(1);
  const [code = ""] = codes;
  expect(code).toMatch(/^T\d+⁺$/);
  await expect(page.getByText(/\(prototype\)/)).toHaveCount(0);

  await page.reload();
  await openGuided(page);
  expect(await addedCodes(page)).toEqual([code]);
  await expect(page.getByText(code, { exact: true }).first()).toBeAttached();
});

test("a task with add what the AI missed turned off shows no add button", async ({ page }) => {
  test.setTimeout(90_000);
  await openGuided(page);
  const changed = await page.evaluate(async (task) => {
    const response = await fetch(`/api/review-tasks/${task}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ display: { add_missed: false } }),
    });
    return ((await response.json()) as { display: { add_missed?: boolean } }).display.add_missed;
  }, rt14);
  expect(changed).toBe(false);
  await page.reload();
  await openGuided(page);
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText(/T5/);
  await expect(addRegion(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /the AI missed/ })).toHaveCount(0);
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=region`);
  await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole("button", { name: /the AI missed/ })).toHaveCount(0);
});

test("the task owner turns add what the AI missed off in the wizard and the task is created without it", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(`/projects/${p07}/tasks/new?scene=how`);
  const body = page.getByTestId("new-task");
  const toggle = body.getByRole("switch", { name: /^Reviewers can add a .* the AI missed/ });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await body.getByRole("button", { name: "Next" }).click();
  await expect(body.locator('[aria-current="step"]')).toHaveText(/Send/);
  const created = page.waitForRequest(
    (request) => request.method() === "POST" && /\/review-tasks$/.test(request.url()),
  );
  await body.getByRole("button", { name: /^Create and notify/ }).click();
  expect((await created).postDataJSON()).toMatchObject({ add_missed: false });
});

test("the guided still draws the missed region and lists it after a reload", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=region`);
  const add = page.getByRole("button", { name: "Add a region the AI missed" });
  await expect(add).toBeVisible({ timeout: 25_000 });
  await add.click();
  const draw = page.getByTestId("missed-panel");
  await expect(draw.getByRole("heading", { name: "Draw the region the AI missed" })).toBeVisible();
  const still = page.locator("[data-slot=slide-still]");
  const box = (await still.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  for (const [x, y] of [
    [0.3, 0.3],
    [0.6, 0.32],
    [0.58, 0.6],
  ] as const) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  }
  await expect(page.getByTestId("redraw-vertex")).toHaveCount(3);
  const saved = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().endsWith("/added"),
  );
  await draw.getByRole("button", { name: "Finish outline" }).click();
  const code = ((await (await saved).json()) as { code: string }).code;
  expect(code).toMatch(/^T\d+⁺$/);
  await expect(page.getByText(`${code} saved as your own object.`)).toBeVisible();
  await expect(page.getByText(/\(prototype\)/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("added-objects")).toContainText(code, { timeout: 25_000 });
});

test("on a cell the guided still saves the missed object as a cell", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=grid`);
  const add = page.getByRole("button", { name: "Add a cell the AI missed" });
  await expect(add).toBeVisible({ timeout: 25_000 });
  await add.click();
  const draw = page.getByTestId("missed-panel");
  await expect(draw.getByRole("heading", { name: "Draw the cell the AI missed" })).toBeVisible();
  const box = (await page.locator("[data-slot=slide-still]").boundingBox()) ?? {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };
  for (const [x, y] of [
    [0.3, 0.2],
    [0.36, 0.22],
    [0.33, 0.28],
  ] as const) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  }
  const saved = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith("/added"),
  );
  await draw.getByRole("button", { name: "Finish outline" }).click();
  expect((await saved).postDataJSON()).toMatchObject({ kind: "cell" });
});
