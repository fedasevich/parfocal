import { expect, type Page, test } from "./a11y.ts";
import { outlineModel, pickOutlineModel } from "./outline-model.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

async function openSmart(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await page.keyboard.press("s");
  await expect(stage).toHaveAttribute("data-tool", "smart");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  return { stage, centre };
}

const layer = (page: Page) => page.getByTestId("smart-layer");
const proposals = (page: Page) => page.getByTestId("proposal-layer");

async function settled(page: Page) {
  await expect(layer(page)).toHaveAttribute("data-phase", "ready");
}

test("a click is a positive point and shows one proposal with Accept and Discard", async ({
  page,
}) => {
  const { centre } = await openSmart(page);
  await page.mouse.click(centre.x, centre.y);
  await settled(page);
  await expect(layer(page)).toHaveAttribute("data-points", "1");
  await expect(layer(page)).toHaveAttribute("data-negatives", "0");
  await expect(layer(page)).toHaveAttribute("data-live", "1");
  await expect(proposals(page)).toHaveAttribute("data-proposals", "1");
  await expect(page.getByTestId("smart-positive")).toHaveCount(1);
  await expect(page.getByTestId("context-bar")).toHaveAttribute("data-mode", "proposals");
  await expect(page.getByTestId("proposal-accept")).toBeVisible();
  await expect(page.getByTestId("proposal-discard")).toBeVisible();
});

test("Shift+click extends the same object", async ({ page }) => {
  const { centre } = await openSmart(page);
  await page.mouse.click(centre.x, centre.y);
  await settled(page);
  await page.keyboard.down("Shift");
  await page.mouse.click(centre.x + 12, centre.y);
  await page.keyboard.up("Shift");
  await expect(layer(page)).toHaveAttribute("data-points", "2");
  await settled(page);
  await expect(layer(page)).toHaveAttribute("data-kept", "0");
  await expect(proposals(page)).toHaveAttribute("data-proposals", "1");
});

test("right-click and Alt+click are negative points", async ({ page }) => {
  const { centre } = await openSmart(page);
  await page.mouse.click(centre.x, centre.y);
  await settled(page);
  await page.mouse.click(centre.x + 6, centre.y, { button: "right" });
  await expect(layer(page)).toHaveAttribute("data-negatives", "1");
  await settled(page);
  await page.keyboard.down("Alt");
  await page.mouse.click(centre.x - 6, centre.y);
  await page.keyboard.up("Alt");
  await expect(layer(page)).toHaveAttribute("data-negatives", "2");
  await expect(page.getByTestId("smart-negative")).toHaveCount(2);
  await expect(proposals(page)).toHaveAttribute("data-proposals", "1");
});

test("a drag is a box prompt", async ({ page }) => {
  const { centre } = await openSmart(page);
  await page.mouse.move(centre.x - 30, centre.y - 20);
  await page.mouse.down();
  await page.mouse.move(centre.x + 30, centre.y + 20, { steps: 5 });
  await expect(page.getByTestId("smart-box-preview")).toHaveCount(1);
  await page.mouse.up();
  await settled(page);
  await expect(layer(page)).toHaveAttribute("data-box", "1");
  await expect(layer(page)).toHaveAttribute("data-points", "0");
  await expect(proposals(page)).toHaveAttribute("data-proposals", "1");
});

test("a plain click keeps the object and starts another", async ({ page }) => {
  const { centre } = await openSmart(page);
  await page.mouse.click(centre.x - 80, centre.y);
  await settled(page);
  await page.mouse.click(centre.x + 80, centre.y);
  await expect(layer(page)).toHaveAttribute("data-kept", "1");
  await settled(page);
  await expect(proposals(page)).toHaveAttribute("data-proposals", "2");
});

test("Backspace removes the last point and then the box", async ({ page }) => {
  const { centre } = await openSmart(page);
  await page.mouse.click(centre.x, centre.y);
  await settled(page);
  await page.keyboard.down("Shift");
  await page.mouse.click(centre.x + 10, centre.y);
  await page.keyboard.up("Shift");
  await expect(layer(page)).toHaveAttribute("data-points", "2");
  await settled(page);
  await page.keyboard.press("Backspace");
  await expect(layer(page)).toHaveAttribute("data-points", "1");
  await settled(page);
  await page.keyboard.press("Backspace");
  await expect(layer(page)).toHaveAttribute("data-points", "0");
  await expect(proposals(page)).toHaveCount(0);
});

test("Enter accepts the proposal as a shape and the next click starts a new session", async ({
  page,
}) => {
  const { stage, centre } = await openSmart(page);
  await page.mouse.click(centre.x, centre.y);
  await settled(page);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("polygon-shape")).toHaveCount(1);
  await expect(proposals(page)).toHaveCount(0);
  await expect(layer(page)).toHaveAttribute("data-points", "0");
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  await page.mouse.click(centre.x + 100, centre.y + 40);
  await settled(page);
  await expect(proposals(page)).toHaveAttribute("data-proposals", "1");
});

test("smart select starts on Good, asks the server for nothing, and Enter accepts after a rail click", async ({
  page,
}) => {
  const embeds: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/embeddings/")) embeds.push(request.url());
  });
  const { stage, centre } = await openSmart(page);
  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-tool", "select");
  await page.locator('button[data-tool="smart"]').click();
  await expect(stage).toHaveAttribute("data-tool", "smart");
  await expect(outlineModel(page)).toHaveAttribute("data-tier", "good");
  await page.mouse.click(centre.x, centre.y);
  await settled(page);
  await expect(proposals(page)).toHaveAttribute("data-proposals", "1");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("polygon-shape")).toHaveCount(1);
  expect(embeds).toEqual([]);
});

interface FakePrompts {
  __parfocalFakePrompts: {
    prompt: { points: { positive: boolean }[]; previousLogits: Float32Array | null };
  }[];
}

test("a click inside the found shape refines it, a right click cuts it, a kept cell reopens", async ({
  page,
}) => {
  const { centre } = await openSmart(page);
  const requests = () =>
    page.evaluate(() =>
      (globalThis as unknown as FakePrompts).__parfocalFakePrompts.map((item) => ({
        positives: item.prompt.points.filter((point) => point.positive).length,
        negatives: item.prompt.points.filter((point) => !point.positive).length,
        mask: item.prompt.previousLogits !== null,
      })),
    );
  await expect(page.getByTestId("smart-hint")).toBeVisible();
  await page.mouse.click(centre.x, centre.y);
  await settled(page);
  await page.mouse.click(centre.x + 6, centre.y);
  await expect(layer(page)).toHaveAttribute("data-points", "2");
  await settled(page);
  await expect(layer(page)).toHaveAttribute("data-kept", "0");
  await expect(proposals(page)).toHaveAttribute("data-proposals", "1");
  expect((await requests()).at(-1)).toEqual({ positives: 2, negatives: 0, mask: true });

  await page.mouse.click(centre.x + 8, centre.y, { button: "right" });
  await expect(layer(page)).toHaveAttribute("data-negatives", "1");
  await settled(page);
  await expect(layer(page)).toHaveAttribute("data-kept", "0");
  expect((await requests()).at(-1)).toEqual({ positives: 2, negatives: 1, mask: true });

  await page.mouse.click(centre.x - 160, centre.y);
  await expect(layer(page)).toHaveAttribute("data-kept", "1");
  await settled(page);
  await page.mouse.click(centre.x, centre.y);
  await expect(layer(page)).toHaveAttribute("data-points", "4");
  await settled(page);
  await expect(layer(page)).toHaveAttribute("data-kept", "1");
  await expect(proposals(page)).toHaveAttribute("data-proposals", "2");
});

test("Escape discards the proposal and keeps the tool", async ({ page }) => {
  const { stage, centre } = await openSmart(page);
  await page.mouse.click(centre.x, centre.y);
  await settled(page);
  await page.keyboard.press("Escape");
  await expect(proposals(page)).toHaveCount(0);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(0);
  await expect(stage).toHaveAttribute("data-tool", "smart");
  await expect(layer(page)).toHaveAttribute("data-points", "0");
  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-tool", "select");
});

test("picking a model, clicking a nucleus and accepting saves the outline", async ({ page }) => {
  test.slow();
  const { stage, centre } = await openSmart(page);
  const choice = outlineModel(page);
  await expect(choice).toHaveAttribute("data-tier", "good");
  await choice.click();
  const good = page.getByRole("option", { name: /^Good/ });
  await expect(good).toHaveAttribute("aria-selected", "true");
  await expect(good).toContainText("Runs on this computer, also offline.");
  await expect(good).toContainText("PathoSAM ViT-B");
  await expect(page.getByRole("option", { name: /^Best/ })).toHaveAttribute(
    "aria-selected",
    "false",
  );
  await page.keyboard.press("Escape");
  await pickOutlineModel(page, "Best");
  await pickOutlineModel(page, "Good");
  await page.mouse.click(centre.x, centre.y);
  await settled(page);
  await expect(proposals(page)).toHaveAttribute("data-proposals", "1");
  await page.getByTestId("proposal-accept").click();
  await expect(page.getByTestId("polygon-shape")).toHaveCount(1);
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  await page.reload();
  await expect(stage).toHaveAttribute("data-annotations", "loaded", { timeout: 15_000 });
  await expect(page.getByTestId("polygon-shape")).toHaveCount(1);
});

test("Cmd+Z takes back live clicks one by one before it undoes the saved shape", async ({
  page,
}) => {
  const { stage, centre } = await openSmart(page);
  const corner = { x: centre.x - 300, y: centre.y - 200 };
  await page.keyboard.press("p");
  for (const [x, y] of [
    [0, 0],
    [120, 10],
    [100, 120],
    [10, 100],
  ] as const) {
    await page.mouse.click(corner.x + x, corner.y + y);
  }
  await page.mouse.click(corner.x + 2, corner.y + 1);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(1);
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  await page.keyboard.press("s");
  await expect(stage).toHaveAttribute("data-tool", "smart");

  await page.mouse.click(centre.x + 100, centre.y + 40);
  await settled(page);
  await page.keyboard.down("Shift");
  await page.mouse.click(centre.x + 110, centre.y + 40);
  await settled(page);
  await page.mouse.click(centre.x + 120, centre.y + 40);
  await page.keyboard.up("Shift");
  await expect(layer(page)).toHaveAttribute("data-points", "3");
  await settled(page);

  await page.keyboard.press("Meta+z");
  await expect(layer(page)).toHaveAttribute("data-points", "2");
  await expect(page.getByTestId("smart-undone")).toHaveText("Took back the last click");
  await settled(page);
  await page.keyboard.press("Meta+z");
  await expect(layer(page)).toHaveAttribute("data-points", "1");
  await settled(page);
  await expect(proposals(page)).toHaveAttribute("data-proposals", "1");
  await expect(page.getByTestId("polygon-shape")).toHaveCount(1);

  await page.keyboard.press("Meta+Shift+z");
  await expect(layer(page)).toHaveAttribute("data-points", "2");
  await settled(page);
  await page.keyboard.press("Meta+z");
  await expect(layer(page)).toHaveAttribute("data-points", "1");
  await settled(page);

  await page.keyboard.press("Meta+z");
  await expect(layer(page)).toHaveAttribute("data-points", "0");
  await expect(proposals(page)).toHaveCount(0);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(1);

  await page.keyboard.press("Meta+z");
  await expect(page.getByTestId("polygon-shape")).toHaveCount(0);
});
