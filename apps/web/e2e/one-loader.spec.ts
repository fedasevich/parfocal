import type { Page } from "./a11y.ts";
import { expect, test } from "./a11y.ts";

type Look = {
  background: string;
  mark: { x: number; y: number; width: number; height: number };
  groupCentre: { x: number; y: number };
  viewport: { width: number; height: number };
};

const lookOf = (page: Page): Promise<Look> =>
  page.evaluate(() => {
    const loader = document.querySelector('[data-testid="boot-loader"]');
    const mark = loader?.querySelector('svg[data-slot="brand-mark"]')?.getBoundingClientRect();
    const name = [...(loader?.querySelectorAll("span") ?? [])].find(
      (span) => span.textContent === "Parfocal",
    );
    const nameBox = name?.getBoundingClientRect();
    const main = loader?.querySelector("main");
    if (!mark || !nameBox || !main) throw new Error("the loader is not on the page");
    const left = Math.min(mark.left, nameBox.left);
    const right = Math.max(mark.right, nameBox.right);
    const top = Math.min(mark.top, nameBox.top);
    const bottom = Math.max(mark.bottom, nameBox.bottom);
    return {
      background: getComputedStyle(main).backgroundColor,
      mark: { x: mark.x, y: mark.y, width: mark.width, height: mark.height },
      groupCentre: { x: (left + right) / 2, y: (top + bottom) / 2 },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });

async function holdScripts(page: Page) {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() === "script") await held;
    await route.continue();
  });
  return release;
}

async function holdSession(page: Page) {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : "";
      if (url.includes("/api/")) await new Promise(() => undefined);
      return original(input, init);
    };
  });
}

for (const theme of ["dark", "light"] as const) {
  test(`the static loader and the app loader are one look in the ${theme} theme`, async ({
    page,
  }) => {
    await page.addInitScript((choice) => {
      window.localStorage.setItem("parfocal.device-settings", JSON.stringify({ theme: choice }));
    }, theme);
    await holdSession(page);
    const release = await holdScripts(page);
    await page.goto("/my-work", { waitUntil: "commit" });
    await expect(page.locator(".boot-loader-page")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const staticLook = await lookOf(page);
    release();
    await expect(page.locator(".boot-loader-page")).toHaveCount(0);
    await expect(page.getByTestId("boot-loader")).toBeVisible();
    const appLook = await lookOf(page);

    expect(staticLook.background).toBe(appLook.background);
    expect(staticLook.background).toBe(theme === "dark" ? "rgb(18, 18, 18)" : "rgb(236, 236, 236)");
    expect(Math.abs(staticLook.mark.x - appLook.mark.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(staticLook.mark.y - appLook.mark.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(staticLook.mark.width - appLook.mark.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(staticLook.mark.height - appLook.mark.height)).toBeLessThanOrEqual(2);
  });
}

test("the mark and the name are centred together and the mark is sized to the name", async ({
  page,
}) => {
  await holdSession(page);
  await page.goto("/my-work");
  await expect(page.getByTestId("boot-loader")).toBeVisible();
  const look = await lookOf(page);
  expect(Math.abs(look.groupCentre.x - look.viewport.width / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(look.groupCentre.y - look.viewport.height / 2)).toBeLessThanOrEqual(2);
  expect(look.mark.width).toBeGreaterThanOrEqual(20);
  expect(look.mark.width).toBeLessThanOrEqual(32);
});
