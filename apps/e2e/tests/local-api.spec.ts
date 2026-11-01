import { expect, test } from "@playwright/test";
import { signIn, username } from "./support.ts";

test("home reads the local API when the fake API is off", async ({ page }) => {
  const mocked: string[] = [];
  page.on("response", (response) => {
    if (response.fromServiceWorker()) mocked.push(response.url());
  });
  await signIn(page, "/");
  const meResponse = await page.request.get("/api/me");
  expect(meResponse.status()).toBe(200);
  const me = (await meResponse.json()) as { display_name: string; email: string | null };
  expect(me.email?.toLowerCase()).toBe(username.toLowerCase());
  expect(me.display_name).not.toBe("Lenka Malá");
  const firstName = me.display_name.split(" ")[0] ?? me.display_name;
  await expect(page.getByRole("heading", { level: 1 })).toContainText(firstName);
  await expect(page.getByText("Loading your home…")).toHaveCount(0);
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByTestId("account-name")).toHaveText(me.display_name);
  await expect(page.getByTestId("fake-data-badge")).toHaveCount(0);
  const worker = await page.evaluate(
    "navigator.serviceWorker.getRegistration().then((found) => found?.active?.scriptURL ?? null)",
  );
  expect(worker).toBeNull();
  expect(mocked).toEqual([]);
});
