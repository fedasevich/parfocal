import { expect, type Page, test } from "./a11y.ts";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

const cards = (page: Page) => page.locator('[data-slot="thread-card"]');

test("the Comments tab lists open threads and swaps to the resolved ones", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/comments?slide=${a1}&thread=T2`);
  await expect(page.getByRole("radio", { name: "Open 3" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Resolved 1" })).toBeVisible();
  await expect(cards(page)).toHaveCount(3);
  await expect(cards(page).first()).toContainText("Histiocyte, not tumor");
  await expect(cards(page).nth(1)).toContainText("Does the boundary run past the capsule fold?");
  await expect(cards(page).nth(1)).toHaveAttribute("data-selected", "true");
  await page.getByRole("radio", { name: "Resolved 1" }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText("T4");
  await expect(cards(page).first()).toContainText("Resolved");
});

test("the comments route without a slide opens the task's first slide", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/comments`);
  await expect(page.getByRole("radio", { name: "Open 3" })).toBeChecked({ timeout: 15_000 });
  await expect(cards(page)).toHaveCount(3);
  await expect(page.getByText("Loading the slide")).toHaveCount(0);
});

test("a thread card opens its thread and Go to follows the location", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/comments?slide=${a1}&thread=T2`);
  await cards(page)
    .first()
    .getByRole("button", { name: /Histiocyte, not tumor/ })
    .click();
  await expect(page).toHaveURL(/thread=T1%C2%B7C145|thread=T1·C145/);
  await expect(page.getByRole("region", { name: "Thread on T1·C145" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Thread on T1·C145" })).toContainText(
    "@Lenka Malá agreed",
  );
  await cards(page).nth(2).getByRole("button", { name: "Go to R2⁺" }).click();
  await expect(page.getByRole("region", { name: "Thread on R2⁺" })).toBeVisible();
});

test("a resolved thread opens under the Resolved filter", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/comments?slide=${a1}&thread=T4`);
  await expect(page.getByRole("radio", { name: "Resolved 1" })).toBeChecked();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toHaveAttribute("data-selected", "true");
});

test("the Open and Resolved switch fits the narrowest side panel under its title", async ({
  page,
}) => {
  await page.goto(
    `/projects/00000000-0000-4000-8003-000000000007/slides/${a1}?task=${rt14}&tab=comments`,
  );
  const comments = page.getByTestId("stage-comments");
  await expect(comments).toBeVisible({ timeout: 20_000 });
  const handle = page.getByRole("separator", { name: "Resize the side panel" });
  await handle.focus();
  for (let press = 0; press < 3; press++) await page.keyboard.press("ArrowRight");
  const panel = page.getByRole("complementary", { name: "Side panel" });
  await expect.poll(async () => Math.round((await panel.boundingBox())?.width ?? 0)).toBe(280);
  const title = comments.locator('[data-slot="comments-title"]');
  await expect(title).toHaveAttribute("title", /^Threads on /);
  const group = comments.getByRole("radiogroup", { name: "Show threads" });
  const [frame, switchBox, titleBox] = await Promise.all([
    panel.boundingBox(),
    group.boundingBox(),
    title.boundingBox(),
  ]);
  if (!frame || !switchBox || !titleBox) throw new Error("the Comments tab did not render");
  expect(switchBox.x).toBeGreaterThanOrEqual(frame.x);
  expect(switchBox.x + switchBox.width).toBeLessThanOrEqual(frame.x + frame.width);
  expect(switchBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
  await expect(comments.getByRole("radio", { name: /^Resolved \d+$/ })).toBeVisible();
});
