import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const tumor044 = "00000000-0000-4000-8005-000000000005";
const rt14 = "00000000-0000-4000-8007-000000000014";

test.use({ viewport: { width: 1440, height: 900 } });

const fullViewer = `/projects/${p07}/slides/${tumor044}?task=${rt14}&as=DH`;
const guided = `/tasks/${rt14}/guided?slide=${tumor044}&as=DH`;
const a1 = "00000000-0000-4000-8005-000000000001";
const objectsViewer = `/projects/${p07}/slides/${a1}?task=${rt14}`;
const objectsGuided = `/tasks/${rt14}/guided?slide=${a1}`;

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
  await page.goto(objectsViewer);
  await ready(page);
  const list = page.getByTestId("stage-review-objects");
  await expect(list.getByTestId("stage-review-object").first()).toBeVisible();
  const row = list.getByTestId("stage-review-object").first();
  const answers = row.getByRole("group").getByRole("button");
  await answers.first().click();
  await expect(row).not.toHaveAttribute("data-decision", "");
});

test("guided review decides the current object and steps to the next open one", async ({
  page,
}) => {
  await page.goto(objectsGuided);
  await ready(page);
  const card = page.getByTestId("stage-review-objects");
  await expect(card).toHaveAttribute("data-guided", "true");
  await expect(card).not.toHaveAttribute("data-current", "");
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

test("a link to an object's comments opens its decision notes on the stage", async ({ page }) => {
  await page.goto(`${objectsViewer}&object=T5&tab=comments&as=DH`);
  await ready(page);
  const notes = page.getByRole("region", { name: "Decision notes on T5" });
  await expect(notes).toContainText("Note on decision: Disagree");
  await page.getByRole("button", { name: "All comments on this slide" }).click();
  await expect(page.getByTestId("stage-object-notes")).toHaveCount(0);
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

test("the minimap shows the slide overview with a viewport box that shrinks on zoom", async ({
  page,
}) => {
  await page.goto(fullViewer);
  const stage = await ready(page);
  const minimap = page.getByTestId("stage-minimap");
  await expect(minimap).toBeVisible();
  await expect(minimap.locator("image")).toHaveAttribute(
    "href",
    `/api/slides/${tumor044}/thumbnail`,
  );
  const box = minimap.locator('[data-slot="map-viewport"]').first();
  await expect(box).toBeAttached();
  const before = Number(await box.getAttribute("width"));
  const area = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  await page.mouse.wheel(0, -600);
  await expect.poll(async () => Number(await box.getAttribute("width"))).toBeLessThan(before);
});

test("New comment and the C key arm the comment tool from the Comments tab in annotate", async ({
  page,
}) => {
  await page.goto(`/projects/${p07}/slides/${tumor044}?task=${rt14}&workspace=annotate`);
  const stage = await ready(page);
  await page.getByRole("tab", { name: "Comments" }).click();
  await page.getByRole("button", { name: /New comment/ }).click();
  await expect(stage).toHaveAttribute("data-tool", "comment");
  await page.keyboard.press("Escape");
  await expect(stage).not.toHaveAttribute("data-tool", "comment");
  await page.getByRole("tab", { name: "Comments" }).click();
  await page.keyboard.press("c");
  await expect(stage).toHaveAttribute("data-tool", "comment");
});

test("hide while panning takes the whole side panel away during a drag and brings it back", async ({
  page,
}) => {
  await page.goto(fullViewer);
  const stage = await ready(page);
  await page.getByLabel("Hide while panning").click();
  await expect(page.getByLabel("Hide while panning")).toBeChecked();
  const dock = page.getByTestId("inspector-dock");
  const width = async () => (await dock.boundingBox())?.width ?? 0;
  const open = await width();
  expect(open).toBeGreaterThan(200);
  await page.keyboard.press("h");
  const area = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await page.mouse.move(area.x + 300, area.y + 300);
  await page.mouse.down();
  await page.mouse.move(area.x + 200, area.y + 250, { steps: 8 });
  await expect(dock).toHaveAttribute("data-hidden-while-panning", "true");
  await expect.poll(width).toBeLessThan(2);
  await page.mouse.up();
  await expect.poll(width).toBeGreaterThan(200);
});
