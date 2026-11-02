import { expect, test } from "@playwright/test";

const livePath = "/projects/p-1/slides/s-1/live";

test("a slide whose file cannot be read says so and offers another try", async ({ page }) => {
  const tileRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/tiles/")) tileRequests.push(request.url());
  });
  await page.goto(livePath);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "failed");
  await expect(page.getByRole("alert")).toContainText("The slide file is not available");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(tileRequests.some((url) => url.endsWith("/tiles/s-1/levels.json"))).toBe(true);
  await expect(stage.locator("canvas")).toHaveCount(1);
});

test("trying again opens the slide afresh on a single canvas", async ({ page }) => {
  await page.goto(livePath);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "failed");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(stage).toHaveAttribute("data-state", "failed");
  await expect(stage.locator("canvas")).toHaveCount(1);
});

test("the viewer engine loads with the slide route and not before", async ({ page }) => {
  const scripts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(request.url());
  });
  await page.goto("/");
  const beforeSlide = scripts.filter((url) => url.includes("viewer-engine")).length;
  await page.goto(livePath);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "failed");
  expect(scripts.filter((url) => url.includes("viewer-engine")).length).toBeGreaterThan(
    beforeSlide,
  );
});
