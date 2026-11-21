import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const rt16 = "00000000-0000-4000-8043-000000000016";
const a1 = "00000000-0000-4000-8005-000000000001";
const cellsSlide = "00000000-0000-4000-8005-000000000008";

test.use({ viewport: { width: 1440, height: 900 } });

async function openGuided(page: Page, task: string, slide = a1, extra = "") {
  await page.goto(`/projects/${p07}/slides/${slide}?task=${task}&mode=guided${extra}`);
  const panel = page.getByTestId("stage-review-objects");
  await expect(panel).toHaveAttribute("data-ready", "true", { timeout: 25_000 });
  const start = page.getByRole("button", { name: "Got it, start" });
  if (await start.isVisible()) await start.click();
  return panel;
}

const goInApp = (page: Page, url: string) =>
  page.evaluate((target) => {
    window.history.pushState({}, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, url);

const blur = (page: Page) =>
  page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });

const decisionSaved = (page: Page, object: string) =>
  page.waitForRequest(
    (request) =>
      request.method() === "PUT" &&
      decodeURIComponent(request.url()).endsWith(`/decisions/${object}`),
  );

test("on a 5-point cell the number keys answer how sure, and a low answer offers the fixes", async ({
  page,
}) => {
  const panel = await openGuided(page, rt16, cellsSlide, "&object=C2");
  await expect(panel).toHaveAttribute("data-current", "C2");
  await expect(page.getByTestId("cell-type-bar")).toHaveCount(0);
  await blur(page);
  const saved = decisionSaved(page, "C2");
  await page.keyboard.press("1");
  const body = (await saved).postDataJSON() as { answer?: string; reasons?: string[] };
  expect(body.answer).toBe("1");
  expect(body.reasons ?? []).toEqual([]);
  await expect(panel.getByText("You disagree with the AI on C2")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Redraw the outline" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Change the type" })).toBeVisible();
});

test("on a 5-point region key 5 answers Certainly and moves on", async ({ page }) => {
  const panel = await openGuided(page, rt16);
  const first = (await panel.getAttribute("data-current")) ?? "";
  await blur(page);
  const saved = decisionSaved(page, first);
  await page.keyboard.press("5");
  expect(((await saved).postDataJSON() as { answer?: string }).answer).toBe("5");
  await expect(panel).not.toHaveAttribute("data-current", first);
});

test("on a 3-point cell the type bar keys keep one meaning", async ({ page }) => {
  const panel = await openGuided(page, rt14, cellsSlide, "&object=C2");
  await expect(page.getByTestId("cell-type-bar")).toHaveAttribute("aria-label", "Type for C2");
  await blur(page);
  const saved = decisionSaved(page, "C2");
  await page.keyboard.press("k");
  expect(((await saved).postDataJSON() as { value?: string }).value).toBe("agree");
  await expect(panel).not.toHaveAttribute("data-current", "C2");
});

test("Edit shape opens the handles and the brush from the card", async ({ page }) => {
  const panel = await openGuided(page, rt14);
  const object = (await panel.getAttribute("data-current")) ?? "";
  const fixRow = panel.getByTestId("object-fix-row");
  await fixRow.getByRole("button", { name: /Edit shape/ }).click();
  await expect(page.getByTestId("ai-layer")).toHaveAttribute("data-editing", object);
  const bar = panel.getByTestId("shape-edit-bar");
  await expect(bar).toHaveAttribute("data-tool", "handles");
  await expect(fixRow).toHaveCount(0);
  await bar.getByRole("button", { name: "Brush" }).click();
  await expect(bar).toHaveAttribute("data-tool", "brush");
});

test("a decided disagree keeps its fixes and its reason when Disagree is pressed again", async ({
  page,
}) => {
  const panel = await openGuided(page, rt14);
  const object = (await panel.getAttribute("data-current")) ?? "";
  const answers = page.getByRole("group", { name: `Your answer on ${object}` });
  await answers.getByRole("button", { name: /Disagree/ }).click();
  const reason = panel.getByRole("button", { name: "Boundary is off" });
  await reason.click();
  await expect(reason).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: "Back to the answers" }).click();
  const fixRow = panel.getByTestId("object-fix-row");
  await expect(fixRow.getByRole("button", { name: "Redraw the outline" })).toBeVisible();
  await expect(fixRow.getByRole("button", { name: "Change the type" })).toBeVisible();
  let saves = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes(`/decisions/${object}`)) saves += 1;
  });
  await answers.getByRole("button", { name: /Disagree/ }).click();
  await expect(reason).toHaveAttribute("aria-pressed", "true");
  expect(saves).toBe(0);
});

test("opened again with every object decided, Guided opens on the opinion questions", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const panel = await openGuided(page, rt14);
  const opinion = panel.getByTestId("stage-opinion");
  for (let step = 0; step < 120 && !(await opinion.isVisible()); step++) {
    const object = (await panel.getAttribute("data-current")) ?? "";
    await blur(page);
    await page.keyboard.press("k");
    await expect
      .poll(
        async () =>
          (await opinion.isVisible()) || (await panel.getAttribute("data-current")) !== object,
      )
      .toBe(true);
  }
  await expect(opinion).toBeVisible();
  const back = page.url();
  await goInApp(page, `/projects/${p07}`);
  await expect(panel).toHaveCount(0);
  await goInApp(page, back);
  await expect(panel).toHaveAttribute("data-ready", "true", { timeout: 25_000 });
  await expect(opinion).toBeVisible();
  await expect(panel.getByTestId("stage-review-object")).toHaveCount(0);
});
