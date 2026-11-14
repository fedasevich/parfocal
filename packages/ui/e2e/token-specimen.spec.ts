import { colorTokens, surfaceSpacingPx, unsureColor } from "@parfocal/tokens";
import { expect, type Page, test } from "@playwright/test";

const story = (theme: string) =>
  `/iframe.html?id=components-token-specimen--specimen&viewMode=story&globals=a11y.manual:!true;theme:${theme}`;

const colours = async (page: Page, theme: string) => {
  await page.goto(story(theme));
  await page.locator("[data-testid=token-specimen]").waitFor();
  await page.locator(`[data-theme=${theme}]`).first().waitFor({ state: "attached" });
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>("[data-token]")].map((node) => [
        node.dataset["token"] ?? "",
        getComputedStyle(node).backgroundColor,
      ]),
    ),
  );
};

test("the specimen shows every colour token and they differ between themes", async ({ page }) => {
  const dark = await colours(page, "dark");
  const light = await colours(page, "light");
  for (const token of colorTokens) {
    expect(dark[token], `${token} in dark`).toBeTruthy();
    expect(light[token], `${token} in light`).toBeTruthy();
  }
  for (const token of ["surf-page", "surf-panel", "fg", "line", "accent", "ok", "bad", "canvas"]) {
    expect(dark[token], token).not.toEqual(light[token]);
  }
  expect(dark["unsure"]).toEqual(hex(unsureColor.dark));
  expect(light["unsure"]).toEqual(hex(unsureColor.light));
});

test("the specimen draws every size at its token value", async ({ page }) => {
  await page.goto(story("dark"));
  await page.locator("[data-testid=token-specimen]").waitFor();
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-size]")].map((node) => ({
      name: node.dataset["size"],
      px: Number(node.dataset["px"]),
      width: node.getBoundingClientRect().width,
    })),
  );
  expect(sizes.length).toBeGreaterThanOrEqual(Object.keys(surfaceSpacingPx).length + 7);
  for (const size of sizes) expect(size.width, size.name).toBe(size.px);
});

function hex(value: string) {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(value.slice(at, at + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}
