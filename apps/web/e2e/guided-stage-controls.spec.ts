import { expect, type Page, test } from "./a11y.ts";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";
const outlined = "00000000-0000-4000-8005-000000000004";
const onStage = `/tasks/${rt14}/guided?slide=${a1}`;
const onOutlined = `/tasks/${rt14}/guided?slide=${outlined}`;

test.use({ viewport: { width: 1440, height: 900 } });

const cameraOf = async (page: Page) => {
  const raw = (await page.getByTestId("slide-host").getAttribute("data-camera")) ?? "0,0,0";
  const [x = 0, y = 0, zoom = 0] = raw.split(",").map(Number);
  return { x, y, zoom };
};

const objectsReady = (page: Page) =>
  expect(page.getByTestId("stage-review-objects")).toHaveAttribute("data-ready", "true", {
    timeout: 25_000,
  });

const controls = (page: Page) => page.getByTestId("stage-guided-view");

async function settled(page: Page) {
  let last = "";
  await expect
    .poll(async () => {
      const now = JSON.stringify(await cameraOf(page));
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
}

test("guided review has its own stage controls and no magnification bar", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(onOutlined);
  await objectsReady(page);
  await page.getByRole("button", { name: "Got it, start" }).click();
  await settled(page);
  await expect(page.getByTestId("magnification-bar")).toHaveCount(0);
  await expect(page.getByTestId("stage-pan-hint")).toHaveText("Drag to move, scroll to zoom");
  const current =
    (await page.getByTestId("stage-review-objects").getAttribute("data-current")) ?? "";
  const back = controls(page).getByRole("button", { name: `Back to ${current}` });
  await expect(back).toBeVisible();
  const home = await cameraOf(page);

  const stage = page.getByTestId("slide-stage");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 260, box.y + box.height / 2 - 160, { steps: 10 });
  await page.mouse.up();
  await settled(page);
  const away = await cameraOf(page);
  expect(Math.abs(away.x - home.x) + Math.abs(away.y - home.y)).toBeGreaterThan(1);
  await expect(controls(page)).toHaveAttribute("data-moved", "true");
  await expect(page.getByTestId("stage-pan-hint")).toHaveCount(0);

  await back.click();
  await expect(controls(page)).toHaveAttribute("data-moved", "false");
  await settled(page);
  const again = await cameraOf(page);
  expect(Math.abs(again.x - home.x)).toBeLessThan(2);
  expect(Math.abs(again.y - home.y)).toBeLessThan(2);

  const readout = page.getByTestId("stage-guided-readout");
  const before = (await readout.textContent()) ?? "";
  await controls(page).getByRole("button", { name: "Zoom in" }).click();
  await expect(readout).not.toHaveText(before);
  const zoomedIn = (await readout.textContent()) ?? "";
  await controls(page).getByRole("button", { name: "Zoom out" }).click();
  await expect(readout).not.toHaveText(zoomedIn);

  const whole = controls(page).getByRole("button", { name: "Whole slide" });
  await expect(whole).toHaveAttribute("aria-pressed", "false");
  await whole.click();
  await expect(whole).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await cameraOf(page)).zoom).toBeLessThan(home.zoom);
  await whole.click();
  await expect(whole).toHaveAttribute("aria-pressed", "false");
  await settled(page);
  expect(Math.abs((await cameraOf(page)).zoom - home.zoom)).toBeLessThan(0.05);
});

test("a first run shows four tips each next to its control", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(onStage);
  await objectsReady(page);
  const tip = (text: RegExp) =>
    page
      .locator("div", { hasText: text })
      .filter({ has: page.locator("b") })
      .last();
  const one = tip(/^1The AI found this/);
  const two = tip(/^2Drag to move around/);
  const three = tip(/^3Answer with one of the buttons/);
  const four = tip(/^4The next open object/);
  for (const each of [one, two, three, four]) await expect(each).toBeVisible();

  const box = async (locator: ReturnType<Page["locator"]>) => {
    const found = await locator.boundingBox();
    if (found === null) throw new Error("not on screen");
    return found;
  };
  const view = await box(controls(page));
  const twoBox = await box(two);
  expect(twoBox.y + twoBox.height).toBeLessThanOrEqual(view.y);
  expect(Math.abs(twoBox.x - view.x)).toBeLessThan(24);

  const answers = await box(page.getByRole("group", { name: /^Your answer on / }).first());
  const threeBox = await box(three);
  expect(threeBox.y).toBeGreaterThanOrEqual(answers.y + answers.height - 1);
  expect(threeBox.y - (answers.y + answers.height)).toBeLessThan(160);

  const previous = await box(
    page.getByTestId("stage-review-objects").getByRole("button", { name: /Previous/ }),
  );
  const fourBox = await box(four);
  expect(fourBox.y + fourBox.height).toBeLessThanOrEqual(previous.y + 1);
  expect(previous.y - (fourBox.y + fourBox.height)).toBeLessThan(120);
  const got = await box(page.getByRole("button", { name: "Got it, start" }));
  expect(got.y).toBeGreaterThanOrEqual(fourBox.y + fourBox.height - 1);
});
