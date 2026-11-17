import { expect, test } from "@playwright/test";

const story = (name: string) =>
  `/iframe.html?id=components-sign-in-and-admin--${name}&viewMode=story&globals=a11y.manual:!true`;

test("an empty workspace draws an empty track with no free space claimed", async ({ page }) => {
  await page.goto(story("storage-states"));
  const empty = page.getByTestId("empty");
  await expect(empty.getByRole("img")).toHaveAccessibleName("0 TB used. Copied slides 0 TB");
  await expect(empty.getByText("used", { exact: true })).toBeVisible();
  await expect(empty).not.toContainText("Free");
});

test("a nearly full workspace splits the bar by kind and shows the little space left", async ({
  page,
}) => {
  await page.goto(story("storage-states"));
  const nearly = page.getByTestId("nearly-full");
  await expect(nearly.getByRole("img")).toHaveAccessibleName(
    "4.6 TB of 5 TB used. Copied slides 3.9 TB, Tile cache for remote slides 400 GB, Results and reviews 300 GB, free 400 GB",
  );
  await expect(nearly.getByRole("img").locator("i")).toHaveCount(4);
  await expect(nearly).toContainText("Free400 GB");
});

test("without a capacity the bar names only the space used", async ({ page }) => {
  await page.goto(story("storage-states"));
  const used = page.getByTestId("no-capacity");
  await expect(used.getByRole("img")).toHaveAccessibleName("7 GB used. Copied slides 7 GB");
  await expect(used).not.toContainText("Free");
});
