import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const slide = "00000000-0000-4000-8005-000000000001";
const outlined = "00000000-0000-4000-8005-000000000004";
const cellsSlide = "00000000-0000-4000-8005-000000000008";
const rt14 = "00000000-0000-4000-8007-000000000014";

test.describe.configure({ timeout: 90_000 });
test.use({ viewport: { width: 1440, height: 900 } });

const openLive = async (page: Page, path = `${slide}/live?task=${rt14}&workspace=review`) => {
  await page.goto(`/projects/${p07}/slides/${path}`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 25_000,
  });
  const objects = page.getByTestId("stage-review-objects");
  await expect(objects).toHaveAttribute("data-ready", "true", { timeout: 25_000 });
  return objects;
};

const centre = (page: Page) => page.getByTestId("slide-host").getAttribute("data-camera");

test("the Objects tab shows the summary, filters to open rows and decides T5 from its card", async ({
  page,
}) => {
  const objects = await openLive(page);
  const panel = page.getByTestId("inspector-objects");
  await expect(panel.getByText("Objects on A1")).toBeVisible();
  await expect(panel.getByText("48 of 55")).toBeVisible();
  await expect(panel.getByText("AI says", { exact: true })).toBeVisible();
  const box = await objects.getByTestId("object-list").boundingBox();
  expect(box?.height ?? 0).toBeLessThan(900);
  await expect(objects.getByTestId("object-row-cells")).toContainText("Cells, 50 sampled");
  const foot = page.getByTestId("inspector-objects-foot");
  await expect(foot).toContainText("Go to T5, the first open object");

  await objects.getByRole("button", { name: "Open 7" }).click();
  await expect(objects.getByTestId("object-row")).toHaveCount(1);
  await expect(objects.getByTestId("object-row-cells")).toContainText("6 open");

  await objects.locator('[data-testid="object-row"][data-object="T5"] button').click();
  const card = page.getByTestId("object-foot");
  await expect(card).toHaveAttribute("data-object", "T5");
  await expect(card).toContainText("The AI says T5 is tumor, 52% sure.");
  await expect(card.getByRole("group", { name: "Your answer on T5" })).toBeVisible();

  await page.keyboard.press("k");
  await expect(objects.getByTestId("object-row")).toHaveCount(0);
  await objects.getByRole("button", { name: /^All / }).click();
  await expect(objects.locator('[data-testid="object-row"][data-object="T5"]')).toHaveAttribute(
    "data-decision",
    "agree",
  );
  await expect(panel.getByText("49 of 55")).toBeVisible();
});

test("a row with an outline flies the camera to its object and docks its card", async ({
  page,
}) => {
  const objects = await openLive(page, `${outlined}?task=${rt14}`);
  const before = await centre(page);
  await objects.locator('[data-testid="object-row"][data-object="R2"] button').click();
  await expect.poll(() => centre(page), { timeout: 10_000 }).not.toBe(before);
  await expect(page.getByTestId("object-foot")).toHaveAttribute("data-object", "R2");
  await page.getByTestId("object-foot").getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("object-foot")).toHaveCount(0);
});

test("a cell picked in the cells panel flies there and shows its crop in the card", async ({
  page,
}) => {
  const objects = await openLive(page, `${cellsSlide}?task=${rt14}`);
  await expect(objects.getByTestId("object-row-cells")).toContainText("Cells, 3 sampled");
  await objects.getByRole("button", { name: "Show the cells" }).click();
  const before = await centre(page);
  await page.getByTestId("stage-cells-grid").getByRole("button", { name: /^C2 / }).click();
  await expect.poll(() => centre(page), { timeout: 10_000 }).not.toBe(before);
  const card = page.getByTestId("object-foot");
  await expect(card).toHaveAttribute("data-object", "C2");
  await expect(card.getByTestId("object-foot-crop")).toHaveAttribute(
    "src",
    new RegExp(`/api/slides/${cellsSlide}/cell-crops/\\d+$`),
  );
});

test("a ruler line joins the object list as M1 and its card removes it", async ({ page }) => {
  const objects = await openLive(page);
  const inspector = page.getByTestId("stage-inspector");
  await expect(inspector.getByTestId("measurement-list")).toHaveCount(0);
  const box = (await page.getByTestId("slide-stage").boundingBox()) ?? {
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  };
  await page.keyboard.press("l");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 200, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, y, { steps: 4 });
  await page.mouse.up();
  const row = objects.locator('[data-testid="object-row"][data-object="M1"]');
  await expect(row).toContainText("Measurement");
  await row.getByRole("button").click();
  const card = page.getByTestId("object-foot");
  await expect(card).toHaveAttribute("data-object", "M1");
  await expect(card).toContainText("Measurement · ");
  await card.getByRole("button", { name: "Remove M1" }).click();
  await expect(row).toHaveCount(0);
  await expect(inspector.getByTestId("measurement-list")).toHaveCount(0);
});
