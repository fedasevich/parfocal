import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const tumor044 = "00000000-0000-4000-8005-000000000005";
const rt14 = "00000000-0000-4000-8007-000000000014";

test.use({ viewport: { width: 1440, height: 900 } });

const fullViewer = `/projects/${p07}/slides/${tumor044}?task=${rt14}&as=DH`;
const guided = `/tasks/${rt14}/guided?slide=${tumor044}&as=DH`;

async function ready(page: Page) {
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  return stage;
}

const cameraOf = (page: Page) => page.getByTestId("slide-host").getAttribute("data-camera");

async function noPrototypePictures(page: Page) {
  await expect(page.getByTestId("full-viewer")).toHaveCount(0);
  const stills = await page.evaluate(() =>
    [...document.querySelectorAll("img, image, [style]")].filter((node) =>
      (node.outerHTML ?? "").includes("/mock-assets/"),
    ),
  );
  expect(stills).toHaveLength(0);
}

for (const [name, path] of [
  ["full viewer in a task", fullViewer],
  ["guided review", guided],
] as const) {
  test(`the ${name} draws the real slide and pans and zooms it`, async ({ page }) => {
    await page.goto(path);
    const stage = await ready(page);
    await noPrototypePictures(page);
    const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
    const before = await cameraOf(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -400);
    await expect.poll(() => cameraOf(page)).not.toBe(before);
    const zoomed = await cameraOf(page);
    await page.keyboard.press("h");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2 - 80, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => cameraOf(page)).not.toBe(zoomed);
  });

  test(`the ${name} measures with the ruler and arms select and comment`, async ({ page }) => {
    await page.goto(path);
    const stage = await ready(page);
    const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
    await page.keyboard.press("l");
    await expect(stage).toHaveAttribute("data-tool", "ruler");
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 200, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, y + 3, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByTestId("ruler-layer").locator("text")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await page.keyboard.press("v");
    await expect(stage).toHaveAttribute("data-tool", "select");
    await page.keyboard.press("c");
    await expect(stage).toHaveAttribute("data-tool", "comment");
  });
}

test("the full viewer decides an AI object on the real stage", async ({ page }) => {
  await page.goto(fullViewer);
  await ready(page);
  const list = page.getByTestId("stage-review-objects");
  await expect(list).toBeVisible();
  const row = list.getByTestId("stage-review-object").first();
  const answers = row.getByRole("group").getByRole("button");
  await answers.first().click();
  await expect(row).not.toHaveAttribute("data-decision", "");
});

test("guided review decides the current object and steps to the next open one", async ({
  page,
}) => {
  await page.goto(guided);
  await ready(page);
  const card = page.getByTestId("stage-review-objects");
  await expect(card).toHaveAttribute("data-guided", "true");
  const first = (await card.getAttribute("data-current")) ?? "";
  expect(first).not.toBe("");
  await card
    .getByTestId("stage-review-object")
    .getByRole("group")
    .getByRole("button")
    .first()
    .click();
  await expect(card).not.toHaveAttribute("data-current", first);
});

test("a deep link opens the full viewer at its camera", async ({ page }) => {
  const parts = async () => ((await cameraOf(page)) ?? "").split(",").map(Number);
  await page.goto(fullViewer);
  await ready(page);
  await expect.poll(async () => (await parts()).length).toBe(3);
  const [fitX = 0, fitY = 0, fitZoom = 0] = await parts();
  await page.goto(`${fullViewer}&x=0.25&y=0.75&z=8`);
  await ready(page);
  await expect.poll(async () => (await parts())[2] ?? 0).toBeGreaterThan(fitZoom + 2);
  const [x = 0, y = 0] = await parts();
  expect(x).toBeLessThan(fitX);
  expect(y).toBeGreaterThan(fitY);
});
