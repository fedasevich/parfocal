import { expect, type Locator, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const tumor044 = "00000000-0000-4000-8005-000000000005";

async function openReviewSlide(page: Page): Promise<Locator> {
  await page.goto(`/projects/${p07}/slides/${tumor044}/live?workspace=review&as=DH`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  return stage;
}

async function dragLeft(page: Page, stage: Locator): Promise<void> {
  const box = await stage.boundingBox();
  if (box === null) throw new Error("The slide stage has no box");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.85, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.15, y, { steps: 12 });
  await page.mouse.up();
}

const tilesOf = async (panel: Locator) => Number(await panel.getAttribute("data-tiles"));

test("the view map is computed on demand and asking again after a pan rescores nothing", async ({
  page,
}) => {
  const stage = await openReviewSlide(page);
  await page.getByTestId("stage-inspector").getByRole("tab", { name: "Display" }).click();
  const panel = page.getByTestId("view-map");
  await expect(panel).toHaveAttribute("data-phase", "empty");
  await page.keyboard.press("Alt+5");
  await page.getByTestId("view-map-ask").click();
  await expect(panel).toHaveAttribute("data-phase", "ready");
  await expect(page.getByTestId("view-map-layer")).toBeVisible();
  const first = await tilesOf(panel);
  expect(first).toBeGreaterThan(0);

  await dragLeft(page, stage);
  await dragLeft(page, stage);
  await dragLeft(page, stage);
  await page.getByTestId("view-map-ask").click();
  await expect(panel).toHaveAttribute("data-phase", "ready");
  expect(await tilesOf(panel)).toBe(first);
});

test("a view map waiting for a GPU says so and Cancel stops the wait", async ({ page }) => {
  await page.goto(`/projects/${p07}/slides/${tumor044}/live?workspace=review&as=DH&gpu=queued`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  await page.getByTestId("stage-inspector").getByRole("tab", { name: "Display" }).click();
  const panel = page.getByTestId("view-map");
  await page.keyboard.press("Alt+5");
  await page.getByTestId("view-map-ask").click();
  const notice = page.getByRole("status", { name: "Waiting for a GPU" });
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute("data-kinds", "view-map");
  await expect(panel).toHaveAttribute("data-phase", "scoring");
  await notice.getByRole("button", { name: "Cancel" }).click();
  await expect(notice).toHaveCount(0);
  await expect(panel).toHaveAttribute("data-phase", "empty");
  await expect(page.getByTestId("view-map-status")).not.toContainText("could not be mapped");
});
