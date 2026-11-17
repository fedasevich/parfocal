import { expect, type Page, test } from "./a11y.ts";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

const lastTip = (page: Page) =>
  page.getByText(
    "The next open object comes by itself. Previous and Next take you back to any of them.",
  );
const firstTip = (page: Page) => page.getByText("The AI found this. It is outlined in white.");
const gotIt = (page: Page) => page.getByRole("button", { name: "Got it, start" });
const onStage = `/tasks/${rt14}/guided?slide=${a1}`;
const objectsReady = (page: Page) =>
  expect(page.getByTestId("stage-review-objects")).toHaveAttribute("data-ready", "true", {
    timeout: 20_000,
  });

test("the four tips show once on a first visit to the stage and Got it, start dismisses them for good", async ({
  page,
}) => {
  await page.goto(onStage);
  await objectsReady(page);
  await expect(firstTip(page)).toBeVisible();
  await expect(lastTip(page)).toBeVisible();
  await gotIt(page).click();
  await expect(lastTip(page)).toHaveCount(0);
  await expect(firstTip(page)).toHaveCount(0);
  await page.reload();
  await objectsReady(page);
  await expect(page.getByRole("button", { name: "How guided review works" })).toBeVisible();
  await expect(lastTip(page)).toHaveCount(0);
});

test("How guided review works on the stage brings the tips back", async ({ page }) => {
  await page.goto(onStage);
  await objectsReady(page);
  await gotIt(page).click();
  await expect(lastTip(page)).toHaveCount(0);
  await page.getByRole("button", { name: "How guided review works" }).click();
  await expect(lastTip(page)).toBeVisible();
  await gotIt(page).click();
  await expect(lastTip(page)).toHaveCount(0);
});

test("a deep link to an object on the stage does not open the tips", async ({ page }) => {
  await page.goto(`${onStage}&object=T2`);
  await objectsReady(page);
  await expect(page.getByTestId("stage-review-objects")).toHaveAttribute("data-current", "T2");
  await expect(lastTip(page)).toHaveCount(0);
});

test("a scene or a deep link to an object does not open the tips", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=region`);
  await expect(page.getByText(/The AI says T\d+ is/)).toBeVisible();
  await expect(lastTip(page)).toHaveCount(0);
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=region&object=T2`);
  await expect(page.getByText(/The AI says T2 is/)).toBeVisible();
  await expect(lastTip(page)).toHaveCount(0);
});

test("the first scene keeps showing the tips and Got it, start opens the region scene", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=first`);
  await expect(firstTip(page)).toBeVisible();
  await gotIt(page).click();
  await expect(page).toHaveURL(/scene=region/);
});
