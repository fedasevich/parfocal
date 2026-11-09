import { expect, type Page, test } from "./a11y.ts";

const stages = (page: Page) => page.locator('[data-slot="slide-still"]');

async function openScene(page: Page, name: string) {
  await page.goto("/prototype");
  await page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name, exact: true })
    .click();
  await expect(page.getByTestId("full-viewer")).toBeVisible({ timeout: 20_000 });
}

const clipShare = (page: Page) =>
  page.evaluate(() => {
    const rect = document.querySelector('[data-testid="swipe-b-clip"]');
    const svg = document.querySelector('[data-slot="slide-still"] svg');
    const [x = 0, , width = 1] = (svg?.getAttribute("viewBox") ?? "").split(" ").map(Number);
    return (Number(rect?.getAttribute("x")) - x) / width;
  });

const viewBoxes = (page: Page) =>
  page
    .locator('[data-slot="slide-still"] svg')
    .evaluateAll((all) => all.map((svg) => svg.getAttribute("viewBox")));

const boxOf = async (locator: ReturnType<Page["locator"]>) =>
  (await locator.boundingBox()) ?? { x: 0, y: 0, width: 1, height: 1 };

test("dragging the swipe line moves the split and zooming keeps both halves on the same view", async ({
  page,
}) => {
  await openScene(page, "Visualize · Swipe between two sets");
  const divider = page.getByTestId("swipe-divider");
  await expect(divider).toHaveAttribute("aria-valuenow", "52");
  const stage = await boxOf(stages(page).first());
  const grip = await boxOf(divider);
  const middle = stage.y + stage.height / 2;
  await page.mouse.move(grip.x + grip.width / 2, middle);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width * 0.25, middle, { steps: 8 });
  await page.mouse.up();
  await expect(divider).toHaveAttribute("aria-valuenow", "25");
  expect(await clipShare(page)).toBeCloseTo(0.25, 2);
  await page.mouse.move(stage.x + stage.width * 0.7, middle);
  await page.mouse.wheel(0, -300);
  await expect(divider).toHaveAttribute("aria-valuenow", "25");
  expect(await clipShare(page)).toBeCloseTo(0.25, 2);
  await divider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "27");
});

test("Side by side shows each set in its own pane and the panes pan and zoom together", async ({
  page,
}) => {
  await openScene(page, "Visualize · Objects on the slide");
  await page
    .getByRole("radiogroup", { name: "Ways to show results" })
    .getByRole("radio", { name: "Side by side" })
    .click();
  await expect(page).toHaveURL(/scene=sidebyside/);
  await expect(stages(page)).toHaveCount(2);
  await expect(stages(page).nth(0).getByText(/^A · /)).toBeVisible();
  await expect(stages(page).nth(1).getByText(/^B · /)).toBeVisible();
  const first = await viewBoxes(page);
  expect(first[0]).toBe(first[1]);
  const right = await boxOf(stages(page).nth(1));
  const middle = right.y + right.height / 2;
  await page.mouse.move(right.x + right.width / 2, middle);
  await page.mouse.down();
  await page.mouse.move(right.x + right.width / 2 - 120, middle - 40, { steps: 6 });
  await page.mouse.up();
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await viewBoxes(page))[0]).not.toBe(first[0]);
  const moved = await viewBoxes(page);
  expect(moved[0]).toBe(moved[1]);
});
