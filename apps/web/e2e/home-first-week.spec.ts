import { expect, test } from "./a11y.ts";

test("the tour offer leaves the activity card clear and opening the sample ticks its item", async ({
  page,
}) => {
  await page.goto("/?scene=new");
  const offer = page.getByRole("region", { name: "Tour offer" });
  await expect(offer).toBeVisible({ timeout: 20_000 });
  const activity = page.getByRole("region", { name: "Activity" });
  await expect(activity).toBeVisible();
  const offerBox = await offer.boundingBox();
  const activityBox = await activity.boundingBox();
  expect(offerBox).not.toBeNull();
  expect(activityBox).not.toBeNull();
  if (offerBox === null || activityBox === null) return;
  const apart =
    offerBox.y + offerBox.height <= activityBox.y ||
    activityBox.y + activityBox.height <= offerBox.y ||
    offerBox.x + offerBox.width <= activityBox.x ||
    activityBox.x + activityBox.width <= offerBox.x;
  expect(apart).toBe(true);
  const checklist = page.getByRole("region", { name: "Getting started" });
  await expect(checklist.getByRole("button", { name: "Open the sample project" })).toBeVisible();
  await page.getByRole("button", { name: "Open the project" }).click();
  await expect(page).toHaveURL(/\/projects\//);
  await expect(page.getByText("Sample · sentinel nodes").first()).toBeVisible();
  await page.goBack();
  await expect(checklist).toBeVisible();
  await expect(checklist.getByRole("button", { name: "Open the sample project" })).toHaveCount(0);
});
