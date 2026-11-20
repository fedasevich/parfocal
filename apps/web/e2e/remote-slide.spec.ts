import { expect, test } from "./a11y.ts";

const project = "p-1";
const ownedProject = "P03";

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
  await page.goto(`/projects/${project}/slides/remote-1`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
  expect(reads).toContain("/api/remote-tiles/remote-1/levels.json");
  expect(reads).toContain("/api/remote-tiles/remote-1/slide.tiff");
  await expect(page.getByTestId("remote-tag")).toHaveText("remote");
  await expect(page.getByTestId("remote-offline")).toHaveCount(0);
});

test("a remote slide whose source is down opens from the cache and says so", async ({ page }) => {
  await page.goto(`/projects/${project}/slides/remote-offline-1`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
  await expect(page.getByTestId("remote-tag")).toBeVisible();
  const notices = page.locator('[data-slot="top-stack"]').getByTestId("slide-notices");
  await expect(notices.getByTestId("remote-offline")).toContainText(
    "The source of this slide is not answering",
  );
  await expect(notices).toHaveAttribute("data-notices", /^remote-offline/);
  await page.goto(`/projects/${project}/slides/remote-offline-1?layout=focus`);
  await expect(page.getByTestId("focus-mode")).toBeVisible();
  await expect(notices.getByTestId("remote-offline")).toBeVisible();
});

test("an uploaded slide shows neither the remote tag nor the offline notice", async ({ page }) => {
  await page.goto(`/projects/${project}/slides/s-1`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
  await expect(page.getByTestId("remote-tag")).toHaveCount(0);
  await expect(page.getByTestId("copy-into-parfocal")).toHaveCount(0);
});

test("the owner copies a remote slide into Parfocal from the viewer", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (request.method() === "POST" && pathname.endsWith("/copy-in")) asked.push(pathname);
  });
  await page.goto(`/projects/${ownedProject}/slides/remote-1`);
  const copy = page.getByTestId("copy-into-parfocal");
  await expect(copy).toBeEnabled({ timeout: 15_000 });
  await copy.click();
  await expect(page.getByTestId("copy-outcome")).toBeVisible();
  expect(asked).toEqual(["/api/slides/remote-1/copy-in"]);
});

test("a remote slide whose source is down cannot be copied now", async ({ page }) => {
  await page.goto(`/projects/${ownedProject}/slides/remote-offline-1`);
  await expect(page.getByTestId("copy-into-parfocal")).toBeDisabled({ timeout: 15_000 });
});
