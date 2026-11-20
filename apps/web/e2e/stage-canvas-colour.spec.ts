import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const tumor044 = "00000000-0000-4000-8005-000000000005";
const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

test.use({ viewport: { width: 1440, height: 900 } });

const themes = ["light", "dark"] as const;

async function setTheme(page: Page, theme: string) {
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
  }, theme);
}

async function canvasToken(page: Page) {
  return page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--canvas)";
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  });
}

const backgroundOf = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((node) => getComputedStyle(node).backgroundColor);

async function expectCanvas(page: Page, selector: string) {
  for (const theme of themes) {
    await setTheme(page, theme);
    const token = await canvasToken(page);
    expect(token).not.toBe("rgba(0, 0, 0, 0)");
    await expect.poll(() => backgroundOf(page, selector)).toBe(token);
  }
}

test("the viewer stage paints the canvas colour in both themes", async ({ page }) => {
  await page.goto(`/projects/${p07}/slides/${tumor044}?mode=look&as=DH`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
  await expectCanvas(page, '[data-testid="slide-stage"]');
});

test("the guided review stage paints the canvas colour in both themes", async ({ page }) => {
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&mode=guided`);
  await expect(page.getByTestId("slide-stage")).toBeVisible({ timeout: 20_000 });
  await expectCanvas(page, '[data-testid="slide-stage"]');
});

test("the compare panes paint the canvas colour in both themes", async ({ page }) => {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · Objects tab", exact: true });
  await page.goto((await link.getAttribute("href")) ?? "");
  await page.getByRole("button", { name: /^A1/ }).first().click();
  await page
    .getByRole("dialog", { name: "Slides in this case and task" })
    .getByRole("button", { name: /Side by side with/ })
    .first()
    .click();
  await expect(page.locator("[data-pane]").first()).toBeVisible();
  await expectCanvas(page, "[data-pane] > div > div");
});

test("the slide chip in the guided top bar has no fill of its own", async ({ page }) => {
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&mode=guided`);
  const chip = page.getByTestId("guided-slide-chip");
  await expect(chip).toBeVisible({ timeout: 20_000 });
  expect(await backgroundOf(page, '[data-testid="guided-slide-chip"]')).toBe("rgba(0, 0, 0, 0)");
});
