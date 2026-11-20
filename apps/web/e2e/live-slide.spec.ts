import { expect, test } from "./a11y.ts";

const livePath = "/projects/p-1/slides/missing-1";

test("a slide whose file cannot be read says so and offers another try", async ({ page }) => {
  const tileRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/tiles/")) tileRequests.push(request.url());
  });
  await page.goto(livePath);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "failed");
  const failure = page.getByRole("alert").and(page.locator(":not([data-testid='notice-alert'])"));
  await expect(failure).toContainText("The slide file is not available");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(tileRequests.some((url) => url.endsWith("/tiles/missing-1/levels.json"))).toBe(true);
  await expect(stage.locator("canvas")).toHaveCount(1);
});

test("a slide that cannot open says so in the top bar and turns tools and tabs off", async ({
  page,
}) => {
  await page.goto(`${livePath}?mode=annotate`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "failed");
  await expect(page.getByText("Could not open")).toBeVisible();
  await expect(page.getByText("Opening", { exact: true })).toHaveCount(0);
  await expect(page.locator("button[data-tool]")).toHaveCount(0);
  await expect(page.getByTestId("stage-inspector").getByRole("tab")).toHaveCount(0);
  await page.keyboard.press("p");
  await expect(stage).not.toHaveAttribute("data-tool", "polygon");
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
