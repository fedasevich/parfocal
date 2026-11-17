import { expect, type Locator, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const tumor044 = "00000000-0000-4000-8005-000000000005";

async function openReviewSlide(page: Page): Promise<Locator> {
  await page.goto(`/projects/${p07}/slides/${tumor044}/live?workspace=review&as=DH`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  return stage;
}

async function paintAcross(page: Page, stage: Locator): Promise<void> {
  const box = await stage.boundingBox();
  if (box === null) throw new Error("The slide stage has no box");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.4, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, y, { steps: 10 });
  await page.mouse.up();
}

const paintedOf = async (panel: Locator) => Number(await panel.getAttribute("data-painted"));

test("a painted map is painted, saved, reloaded and opened again", async ({ page }) => {
  test.setTimeout(90_000);
  const stage = await openReviewSlide(page);
  await page.getByTestId("stage-inspector").getByRole("tab", { name: "Display" }).click();
  const panel = page.getByTestId("painted-map");
  await page.getByTestId("painted-map-toggle").click();
  await expect(panel).toHaveAttribute("data-open", "on");
  await expect(panel).toHaveAttribute("data-painted", "0");

  await paintAcross(page, stage);
  await expect.poll(() => paintedOf(panel)).toBeGreaterThan(0);
  await expect(panel).toHaveAttribute("data-dirty", "yes");
  await expect(page.getByTestId("painted-map-picture")).toBeVisible();
  const painted = await paintedOf(panel);

  await page.getByTestId("painted-map-name").fill("Tumor edge");
  await page.getByTestId("painted-map-save").click();
  await expect(panel).toHaveAttribute("data-version", "1");
  await expect(panel).toHaveAttribute("data-dirty", "no");

  await page.reload();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  await page.getByTestId("stage-inspector").getByRole("tab", { name: "Display" }).click();
  await page.getByTestId("painted-map-toggle").click();
  const list = page.getByTestId("painted-map-list");
  await expect(list.locator("option")).toHaveCount(2);
  await list.selectOption({ label: "Tumor edge (v1)" });
  await expect(panel).toHaveAttribute("data-version", "1");
  await expect.poll(() => paintedOf(panel)).toBe(painted);
});
