import { expect, test } from "@playwright/test";

const story = (name: string) =>
  `/iframe.html?id=components-person--${name}&viewMode=story&globals=a11y.manual:!true`;

const fiveNames = "Lenka Malá, Simona Marková, Anna Kopecká, Jan Růžička, Tomáš Beneš";

test("a stack shows three avatars, a +N count and every name", async ({ page }) => {
  await page.goto(story("stack"));
  const stack = page.getByTestId("stack-overflow");
  await expect(stack).toHaveAccessibleName(fiveNames);
  await expect(stack.locator("[data-slot=person-avatar]")).toHaveCount(3);
  await expect(stack.locator("[data-slot=avatar-stack-count]")).toHaveText("+2");
  await expect(
    page.getByTestId("stack-fits").locator("[data-slot=avatar-stack-count]"),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("stack-from-profiles").locator("[data-slot=avatar-stack-count]"),
  ).toHaveText("+5");
});

test("the stack names show in a tooltip on hover", async ({ page }) => {
  await page.goto(story("stack"));
  await page.getByTestId("stack-overflow").hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(fiveNames);
});

test("each avatar takes its colour from the profile colour index", async ({ page }) => {
  await page.goto(story("profile-colours"));
  await expect(page.getByTestId("profile-colour-0")).toHaveCSS(
    "background-color",
    "rgb(37, 99, 235)",
  );
  await expect(page.getByTestId("profile-colour-8")).toHaveCSS(
    "background-color",
    "rgb(8, 145, 178)",
  );
  await expect(page.getByTestId("profile-colour-8")).toHaveCSS("color", "rgb(11, 11, 11)");
});

test("a presence dot names its state", async ({ page }) => {
  await page.goto(story("presence"));
  await expect(page.getByRole("img", { name: "Busy" }).first()).toBeVisible();
  await expect(page.getByRole("img", { name: "Away" }).first()).toBeVisible();
});
