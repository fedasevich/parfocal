import { expect, type Page, test } from "./a11y.ts";

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(90_000);

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";
const cellReview = `/tasks/${rt14}/cells?slide=${a1}&scene=grid`;

const minimap = (page: Page) => page.locator('[data-slot="smart-minimap"]');
const grip = (page: Page) => page.locator('[data-slot="minimap-grip"]');

async function chooseMinimap(page: Page, name: string) {
  await page.goto("/settings/layout");
  const choice = page
    .getByRole("dialog", { name: "Settings" })
    .getByRole("radiogroup", { name: "Minimap" })
    .getByRole("radio", { name });
  await choice.click();
  await expect(choice).toBeChecked();
}

async function openCellReview(page: Page) {
  await page.goto(cellReview);
  await expect(page.getByRole("button", { name: "Agree with the rest" })).toBeVisible({
    timeout: 40_000,
  });
}

async function zoom(page: Page, direction: "in" | "out", steps: number) {
  await page.mouse.move(520, 300);
  for (let step = 0; step < steps; step += 1) {
    await page.mouse.wheel(0, direction === "out" ? 400 : -400);
    await page.waitForTimeout(15);
  }
}

test("When useful hides the cell review minimap zoomed out and shows it after zooming in", async ({
  page,
}) => {
  await openCellReview(page);
  await expect(minimap(page)).toBeVisible();
  await expect(minimap(page)).toHaveAttribute("data-mode", "area");
  await expect(minimap(page)).toContainText("to check");
  await zoom(page, "out", 48);
  await expect(minimap(page)).toHaveCount(0);
  await zoom(page, "in", 48);
  await expect(minimap(page)).toBeVisible();
});

test("Always keeps the cell review minimap when zoomed out", async ({ page }) => {
  await chooseMinimap(page, "Always");
  await openCellReview(page);
  await expect(minimap(page)).toBeVisible();
  await zoom(page, "out", 48);
  await page.waitForTimeout(400);
  await expect(minimap(page)).toBeVisible();
});

test("Never shows no minimap in cell review and Z still opens the whole slide", async ({
  page,
}) => {
  await chooseMinimap(page, "Never");
  await openCellReview(page);
  await page.waitForTimeout(400);
  await expect(minimap(page)).toHaveCount(0);
  await zoom(page, "in", 4);
  await expect(minimap(page)).toHaveCount(0);
  await page.keyboard.press("z");
  await expect(page.getByRole("dialog", { name: "Whole slide" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Whole slide" })).toHaveCount(0);
});

test("the cell review minimap drags to another corner and is there after a reload", async ({
  page,
}) => {
  await openCellReview(page);
  await expect(minimap(page)).toBeVisible();
  await expect(minimap(page)).toHaveAttribute("data-placed", "auto");
  await page.waitForTimeout(700);
  const before = await minimap(page).getAttribute("data-corner");
  const target = before === "top-left" ? "top-right" : "top-left";
  const host = await minimap(page).locator("..").boundingBox();
  const handle = await grip(page).boundingBox();
  if (host === null || handle === null) throw new Error("the minimap has no box");
  const from = [handle.x + handle.width / 2, handle.y + handle.height / 2] as const;
  const to = [
    target === "top-left" ? host.x + 120 : host.x + host.width - 120,
    host.y + 120,
  ] as const;
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(from[0] + 10, from[1] - 10, { steps: 2 });
  await expect(page.locator("[data-landing]")).toHaveCount(4);
  await page.mouse.move(to[0], to[1], { steps: 8 });
  await page.mouse.up();
  await expect(page.locator("[data-landing]")).toHaveCount(0);
  await expect(minimap(page)).toHaveAttribute("data-corner", target);
  await expect(minimap(page)).toHaveAttribute("data-placed", "pinned");
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole("button", { name: "Agree with the rest" })).toBeVisible();
  await expect(minimap(page)).toHaveAttribute("data-corner", target);
  await expect(minimap(page)).toHaveAttribute("data-placed", "pinned");
  await grip(page).dblclick();
  await expect(minimap(page)).toHaveAttribute("data-placed", "auto");
  await expect(minimap(page)).toHaveAttribute("data-corner", before ?? "");
});

test("the arrow keys on the grip move the cell review minimap between corners", async ({
  page,
}) => {
  await openCellReview(page);
  await expect(minimap(page)).toBeVisible();
  await grip(page).focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowLeft");
  await expect(minimap(page)).toHaveAttribute("data-corner", "top-left");
  await page.keyboard.press("ArrowRight");
  await expect(minimap(page)).toHaveAttribute("data-corner", "top-right");
});

const liveSlide = "00000000-0000-4000-8005-000000000008";
const liveCellReview = `/tasks/${rt14}/cells?slide=${liveSlide}`;
const liveMinimap = (page: Page) => page.getByTestId("stage-minimap");

async function openLiveCellReview(page: Page) {
  await page.goto(liveCellReview);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 40_000 });
  await expect(page.getByTestId("stage-cells-grid")).toBeVisible();
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  return [box.x + box.width / 2, box.y + box.height / 3] as const;
}

async function liveZoom(page: Page, at: readonly [number, number], direction: "in" | "out") {
  await page.mouse.move(at[0], at[1]);
  for (let step = 0; step < 14; step += 1) {
    await page.mouse.wheel(0, direction === "out" ? 600 : -600);
    await page.waitForTimeout(60);
  }
}

test("When useful hides the live cell review minimap zoomed out and shows it after zooming in", async ({
  page,
}) => {
  const at = await openLiveCellReview(page);
  await liveZoom(page, at, "out");
  await expect(liveMinimap(page)).toHaveCount(0);
  await liveZoom(page, at, "in");
  await expect(liveMinimap(page)).toBeVisible();
});

test("Always keeps the live cell review minimap when zoomed out", async ({ page }) => {
  await chooseMinimap(page, "Always");
  const at = await openLiveCellReview(page);
  await liveZoom(page, at, "out");
  await page.waitForTimeout(400);
  await expect(liveMinimap(page)).toBeVisible();
});

test("Never shows no minimap in live cell review and Z still opens the whole slide", async ({
  page,
}) => {
  await chooseMinimap(page, "Never");
  const at = await openLiveCellReview(page);
  await liveZoom(page, at, "in");
  await expect(liveMinimap(page)).toHaveCount(0);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-coverage", "loaded");
  await page.keyboard.press("z");
  await expect(page.getByTestId("viewed-peek")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("viewed-peek")).toHaveCount(0);
});

test("the live cell review minimap drags to another corner and is there after a reload", async ({
  page,
}) => {
  const at = await openLiveCellReview(page);
  await liveZoom(page, at, "in");
  await expect(liveMinimap(page)).toBeVisible();
  await expect(liveMinimap(page)).toHaveAttribute("data-placed", "auto");
  await page.waitForTimeout(700);
  const before = await liveMinimap(page).getAttribute("data-corner");
  const target = before === "top-left" ? "top-right" : "top-left";
  const host = await page.getByTestId("slide-stage").boundingBox();
  const handle = await liveMinimap(page).locator('[data-slot="minimap-grip"]').boundingBox();
  if (host === null || handle === null) throw new Error("the minimap has no box");
  const from = [handle.x + handle.width / 2, handle.y + handle.height / 2] as const;
  const to = [
    target === "top-left" ? host.x + 120 : host.x + host.width - 120,
    host.y + 120,
  ] as const;
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(from[0] + 10, from[1] - 10, { steps: 2 });
  await expect(page.locator("[data-landing]")).toHaveCount(4);
  await page.mouse.move(to[0], to[1], { steps: 8 });
  await page.mouse.up();
  await expect(liveMinimap(page)).toHaveAttribute("data-corner", target);
  await expect(liveMinimap(page)).toHaveAttribute("data-placed", "pinned");
  await page.waitForTimeout(500);
  const again = await openLiveCellReview(page);
  await liveZoom(page, again, "in");
  await expect(liveMinimap(page)).toHaveAttribute("data-corner", target);
  await expect(liveMinimap(page)).toHaveAttribute("data-placed", "pinned");
});
