import type { Page } from "./a11y.ts";
import { expect, test } from "./telemetry-capture.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

async function holdApi(page: Page, part = "/api/") {
  await page.addInitScript((heldPart) => {
    const original = window.fetch.bind(window);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    Object.assign(window, { releaseApi: () => release() });
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : "";
      if (url.includes(heldPart)) await held;
      return original(input, init);
    };
  }, part);
}

const releaseApi = (page: Page) =>
  page.evaluate(() => (window as unknown as { releaseApi: () => void }).releaseApi());

const screens = [
  {
    name: "Home",
    path: "/",
    skeleton: "Loading your home",
    loaded: /Good (morning|afternoon|evening)/,
  },
  { name: "My work", path: "/my-work", skeleton: "Loading your work", loaded: "To review" },
  {
    name: "the project slides tab",
    path: `/projects/${p07}?tab=slides`,
    skeleton: "Loading",
    loaded: "Sentinel node AI evaluation",
  },
  { name: "Team", path: "/team", skeleton: "Loading Team", loaded: "Who is reviewing what" },
] as const;

for (const screen of screens) {
  test(`${screen.name} shows the progress bar and skeleton rows before its data arrives`, async ({
    page,
  }) => {
    await holdApi(page);
    await page.goto(screen.path);
    await expect(page.getByRole("progressbar", { name: "Loading" })).toBeAttached();
    const skeleton = page.locator('[data-slot="skeleton-rows"]').first();
    await expect(skeleton).toBeVisible();
    await expect(skeleton).toContainText(screen.skeleton);
    await releaseApi(page);
    await expect(page.locator("main").first()).toContainText(screen.loaded);
    await expect(page.locator('[data-slot="skeleton-rows"]')).toHaveCount(0);
    await expect(page.getByRole("progressbar", { name: "Loading" })).toHaveCount(0);
  });
}

test("the project slides tab shows skeleton rows until its slides arrive", async ({ page }) => {
  await holdApi(page, "/me/slides");
  await page.goto(`/projects/${p07}?tab=slides`);
  const table = page.getByRole("table");
  await expect(table.locator('[data-slot="skeleton-rows"]')).toContainText("Loading slides");
  await expect(page.getByTestId("slide-row")).toHaveCount(0);
  await releaseApi(page);
  await expect(page.getByTestId("slide-row").first()).toBeVisible();
  await expect(table.locator('[data-slot="skeleton-rows"]')).toHaveCount(0);
});
