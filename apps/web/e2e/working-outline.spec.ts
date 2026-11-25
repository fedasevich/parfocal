import { expect, type Page, test } from "./a11y.ts";
import { pickOutlineModel } from "./outline-model.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

async function openSlowBest(page: Page, key: "u" | "s", tool: "auto" | "smart") {
  await page.goto(`/projects/${p07}?tab=slides&best=slow`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await page.keyboard.press(key);
  await expect(stage).toHaveAttribute("data-tool", tool);
  await pickOutlineModel(page, "Best");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragBox(page: Page, centre: { x: number; y: number }, size: number) {
  await page.mouse.move(centre.x - size, centre.y - size);
  await page.mouse.down();
  await page.mouse.move(centre.x, centre.y, { steps: 4 });
  await page.mouse.move(centre.x + size, centre.y + size, { steps: 4 });
  await page.mouse.up();
}

const animationOf = (page: Page, testId: string) =>
  page
    .getByTestId(testId)
    .evaluate((element) => getComputedStyle(element).animationName)
    .catch(() => "missing");

const working = (page: Page) => page.getByTestId("auto-working");
const outline = (page: Page) => page.getByTestId("auto-outline");

test("the region picked for Auto region stays outlined and animated while its tiles are done", async ({
  page,
}) => {
  test.slow();
  const centre = await openSlowBest(page, "u", "auto");
  await dragBox(page, centre, 280);

  await expect(outline(page)).toBeVisible();
  await expect(outline(page)).toHaveAttribute("data-state", "working");
  await expect.poll(() => animationOf(page, "auto-outline")).toBe("pf-march");
  await expect
    .poll(async () => Number((await working(page).getAttribute("data-tiles")) ?? 0))
    .toBeGreaterThanOrEqual(2);
  expect(Number(await working(page).getAttribute("data-tiles"))).toBeGreaterThanOrEqual(2);

  await expect
    .poll(async () => Number((await working(page).getAttribute("data-tiles-done")) ?? 0), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  await expect(
    page.getByTestId("auto-tile").and(page.locator('[data-done="true"]')).first(),
  ).toBeVisible();
  await expect(outline(page)).toHaveAttribute("data-state", "working");

  await expect(page.getByTestId("proposal-layer")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("auto-layer")).toHaveAttribute("data-running", "false");
  await expect(working(page)).toHaveCount(0);
  await expect(outline(page)).toHaveCount(0);
  await page.getByTestId("proposal-discard").click();
  await expect(working(page)).toHaveCount(0);
});

test("the outline holds still and dashed when the system asks for reduced motion", async ({
  page,
}) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const centre = await openSlowBest(page, "u", "auto");
  await dragBox(page, centre, 280);

  await expect(outline(page)).toBeVisible();
  await expect(outline(page)).toHaveAttribute("data-state", "working");
  await expect.poll(() => animationOf(page, "auto-outline")).toBe("none");
  await expect(outline(page)).toHaveAttribute("stroke-dasharray", "6 4");

  await page.keyboard.press("Escape");
  await expect(outline(page)).toHaveCount(0);
});

test("Escape removes the outline of a region that is still being processed", async ({ page }) => {
  test.slow();
  const centre = await openSlowBest(page, "u", "auto");
  await dragBox(page, centre, 280);
  await expect(outline(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(outline(page)).toHaveCount(0);
  await expect(page.getByTestId("auto-layer")).toHaveAttribute("data-running", "false");
});

test("a Smart select box is animated while its request runs and still afterwards", async ({
  page,
}) => {
  test.slow();
  const centre = await openSlowBest(page, "s", "smart");
  await dragBox(page, centre, 40);
  const box = page.getByTestId("smart-box");
  await expect(box).toHaveAttribute("data-state", "working");
  await expect.poll(() => animationOf(page, "smart-box")).toBe("pf-march");
  await expect(page.getByTestId("smart-layer")).toHaveAttribute("data-phase", "ready", {
    timeout: 30_000,
  });
  await expect(box).toHaveAttribute("data-state", "idle");
  await expect.poll(() => animationOf(page, "smart-box")).toBe("none");
});
