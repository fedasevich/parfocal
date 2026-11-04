import { densitySpacingPx } from "@parfocal/tokens";
import { expect, type Page, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`;

const px = (value: number) => `${value}px`;

const geometry = async (page: Page) => {
  await page.locator("[data-slot=side-panel-foot]").waitFor();
  return page.evaluate(() => {
    const box = (selector: string) => {
      const node = document.querySelector(selector);
      if (node === null) throw new Error(`missing ${selector}`);
      return node.getBoundingClientRect();
    };
    return {
      head: box("[data-slot=table-head]").height,
      row: box("[data-slot=table-body] [data-slot=table-row]").height,
      list: box("[data-testid=list]").height,
      settings: box("[data-testid=settings]").height,
      firstCard: box("[data-slot=side-panel-body] > :first-child").top,
      secondCard: box("[data-slot=side-panel-body] > :nth-child(2)").top,
      cardHeight: box("[data-slot=side-panel-body] > :first-child").height,
      foot: box("[data-slot=side-panel-foot]").height,
    };
  });
};

for (const density of ["comfortable", "compact"] as const) {
  test(`the ${density} list and inspector use the ${density} spacing`, async ({ page }) => {
    await page.goto(story(`components-density--${density}`));
    const cell = page.locator("[data-slot=table-cell]").first();
    await expect(cell).toHaveCSS("padding-top", px(densitySpacingPx["cell-y"][density]));
    await expect(cell).toHaveCSS("padding-bottom", px(densitySpacingPx["cell-y"][density]));
    await expect(page.locator("[data-slot=table-head]").first()).toHaveCSS(
      "height",
      px(densitySpacingPx["head-h"][density]),
    );
    const body = page.locator("[data-slot=side-panel-body]");
    await expect(body).toHaveCSS("padding-top", px(densitySpacingPx["panel-pad"][density]));
    await expect(body).toHaveCSS("padding-left", px(densitySpacingPx["panel-pad"][density]));
    await expect(body).toHaveCSS("row-gap", px(densitySpacingPx["panel-gap"][density]));
    const foot = page.locator("[data-slot=side-panel-foot]");
    await expect(foot).toHaveCSS("padding-left", px(densitySpacingPx["foot-x"][density]));
    await expect(foot).toHaveCSS("padding-top", px(densitySpacingPx["foot-top"][density]));
    await expect(foot).toHaveCSS("padding-bottom", px(densitySpacingPx["foot-bottom"][density]));
    await expect(page.getByTestId("page")).toHaveCSS(
      "row-gap",
      px(densitySpacingPx["page-gap"][density]),
    );
    const setting = page.locator("[data-slot=setting-row]").nth(1);
    await expect(setting).toHaveCSS("padding-top", px(densitySpacingPx["list-row-y"][density]));
    await expect(setting).toHaveCSS("padding-bottom", px(densitySpacingPx["list-row-y"][density]));
    const shape = await geometry(page);
    expect(shape.secondCard - shape.firstCard - shape.cardHeight).toBeCloseTo(
      densitySpacingPx["panel-gap"][density],
      0,
    );
  });
}

test("compact fits more rows and a shorter inspector than comfortable", async ({ page }) => {
  await page.goto(story("components-density--comfortable"));
  const comfortable = await geometry(page);
  await page.goto(story("components-density--compact"));
  const compact = await geometry(page);
  const saved = 2 * (densitySpacingPx["cell-y"].comfortable - densitySpacingPx["cell-y"].compact);
  expect(comfortable.row - compact.row).toBeCloseTo(saved, 0);
  expect(compact.list).toBeLessThan(comfortable.list);
  expect(compact.settings).toBeLessThan(comfortable.settings);
  expect(compact.head).toBeLessThan(comfortable.head);
  expect(compact.foot).toBeLessThan(comfortable.foot);
  expect(compact.firstCard).toBeLessThan(comfortable.firstCard);
});

for (const density of ["comfortable", "compact"] as const) {
  test(`the ${density} flow page main column uses the ${density} gap`, async ({ page }) => {
    await page.goto(story(`components-modals-and-flow-pages--flow-${density}`));
    await expect(page.locator("[data-slot=flow-main]")).toHaveCSS(
      "row-gap",
      px(densitySpacingPx["flow-page-gap"][density]),
    );
  });
}
