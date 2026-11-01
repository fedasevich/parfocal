import { expect, test } from "@playwright/test";

test("the dev server answers the app's API calls with a generated MSW handler", async ({
  page,
}) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByTestId("api-health")).toHaveText(/^API \S+$/);
  await expect(page.getByTestId("api-health")).not.toHaveText("API unreachable");
  const worker = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.active?.scriptURL ?? null;
  });
  expect(worker).toMatch(/\/mockServiceWorker\.js$/);
  expect(apiRequests.length).toBeGreaterThan(0);
});
