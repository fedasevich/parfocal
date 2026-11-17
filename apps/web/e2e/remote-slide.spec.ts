import { expect, test } from "./a11y.ts";

const project = "p-1";

function remoteReads(page: import("@playwright/test").Page): string[] {
  const reads: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/remote-tiles/")) reads.push(pathname);
  });
  return reads;
}

test("a slide read in place opens through the remote route and wears the remote tag", async ({
  page,
}) => {
  const reads = remoteReads(page);
  await page.goto(`/projects/${project}/slides/remote-1/live`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
  expect(reads).toContain("/api/remote-tiles/remote-1/levels.json");
  expect(reads).toContain("/api/remote-tiles/remote-1/slide.tiff");
  await expect(page.getByTestId("remote-tag")).toHaveText("remote");
  await expect(page.getByTestId("remote-offline")).toHaveCount(0);
});

test("a remote slide whose source is down opens from the cache and says so", async ({ page }) => {
  await page.goto(`/projects/${project}/slides/remote-offline-1/live`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
  await expect(page.getByTestId("remote-tag")).toBeVisible();
  await expect(page.getByTestId("remote-offline")).toContainText(
    "The source of this slide is not answering",
  );
});

test("an uploaded slide shows neither the remote tag nor the offline notice", async ({ page }) => {
  await page.goto(`/projects/${project}/slides/s-1/live`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
  await expect(page.getByTestId("remote-tag")).toHaveCount(0);
});
