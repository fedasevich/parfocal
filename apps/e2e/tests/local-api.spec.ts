import { expect, test } from "@playwright/test";
import { signIn, username } from "./support.ts";

test("home reads the local API when the fake API is off", async ({ page }) => {
  const mocked: string[] = [];
  page.on("response", (response) => {
    if (response.fromServiceWorker()) mocked.push(response.url());
  });
  await signIn(page, "/");
  await expect(page.getByTestId("session-email")).toHaveText(`Session for ${username}`);
  await expect(page.getByTestId("signed-in-as")).not.toHaveText("Signed in as Lenka Malá");
  await expect(page.getByTestId("fake-data-badge")).toHaveCount(0);
  const worker = await page.evaluate(
    "navigator.serviceWorker.getRegistration().then((found) => found?.active?.scriptURL ?? null)",
  );
  expect(worker).toBeNull();
  expect(mocked).toEqual([]);
});
