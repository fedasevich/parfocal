import { expect, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`;

test("a story reads the scenario through MSW in the built catalogue", async ({ page }) => {
  await page.goto(story("fake-data-signed-in-person--from-the-scenario"));
  await expect(page.getByTestId("signed-in-as")).toHaveText("Lenka Malá");
  await expect(page.getByTestId("job-count")).toHaveText("4 jobs");
});

test("a story's own handler wins over the scenario", async ({ page }) => {
  await page.goto(story("fake-data-signed-in-person--with-an-override"));
  await expect(page.getByTestId("signed-in-as")).toHaveText("Daniel Hruška");
});
