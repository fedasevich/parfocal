import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";
const cellsSlide = "00000000-0000-4000-8005-000000000008";

type Box = { x: number; y: number; width: number; height: number };
type Part = { name: string; box: Box };

const parts = [
  '[data-slot="top-stack"] > *',
  '[data-slot="stage-tools"]',
  '[data-slot="magnification-bar"]',
  '[data-slot="smart-minimap"]',
  '[data-testid="travel-minimap"]',
  '[data-testid="cell-type-bar"]',
  '[data-testid="stage-cells-grid"]',
  '[data-testid="whole-slide-button"]',
  '[data-testid="stage-pan-hint"]',
  '[data-testid="stage-guided-view"]',
].join(",");

const meets = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function measured(page: Page): Promise<{ stage: Box; parts: Part[] }> {
  return page.evaluate((selector) => {
    const stage = document.querySelector<HTMLElement>('[data-testid="slide-stage"]');
    if (stage === null) throw new Error("no stage");
    const boxOf = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const found = [...stage.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
      })
      .filter(
        (element, _, all) => !all.some((other) => other !== element && other.contains(element)),
      )
      .map((element) => ({
        name: element.dataset["slot"] ?? element.dataset["testid"] ?? element.tagName,
        box: boxOf(element),
      }));
    return { stage: boxOf(stage), parts: found };
  }, parts);
}

function expectApart(stage: Box, found: Part[]) {
  for (const { name, box } of found) {
    expect(box.x, `${name} starts inside the stage`).toBeGreaterThanOrEqual(stage.x - 0.5);
    expect(box.y, `${name} starts inside the stage`).toBeGreaterThanOrEqual(stage.y - 0.5);
    expect(box.x + box.width, `${name} ends inside the stage`).toBeLessThanOrEqual(
      stage.x + stage.width + 0.5,
    );
    expect(box.y + box.height, `${name} ends inside the stage`).toBeLessThanOrEqual(
      stage.y + stage.height + 0.5,
    );
  }
  for (const [index, a] of found.entries()) {
    for (const b of found.slice(index + 1)) {
      expect(meets(a.box, b.box), `${a.name} meets ${b.name}`).toBe(false);
    }
  }
}

async function minimapAlways(page: Page) {
  await page.goto("/settings/layout");
  const radio = page
    .getByRole("dialog", { name: "Settings" })
    .getByRole("radiogroup", { name: "Minimap" })
    .getByRole("radio", { name: "Always" });
  await radio.click();
  await expect(radio).toBeChecked();
}

async function ready(page: Page) {
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
}

const screens = {
  "the full viewer with a tool hint and the open magnification bar": async (page: Page) => {
    await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}`);
    await ready(page);
    await page.getByRole("button", { name: "Measure (L)" }).click();
    await page.locator('[data-slot="magnification-bar"]').first().click();
    return 1;
  },
  "guided review on a cell": async (page: Page) => {
    await page.goto(`/tasks/${rt14}/guided?slide=${cellsSlide}`);
    await ready(page);
    await expect(page.getByTestId("cell-type-bar")).toBeVisible();
    return 2;
  },
  "the cells grid with a cell picked": async (page: Page) => {
    await page.goto(`/projects/${p07}/slides/${cellsSlide}?task=${rt14}`);
    await ready(page);
    await page
      .getByTestId("stage-review-objects")
      .getByRole("button", { name: "Show the cells" })
      .click();
    await page.getByTestId("stage-cells-grid").getByRole("button", { name: /^C2 / }).click();
    await expect(page.getByTestId("cell-type-bar")).toBeVisible();
    return 3;
  },
};

for (const [screen, open] of Object.entries(screens)) {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 1024, height: 700 },
  ]) {
    test(`${screen} keeps every stage part apart and inside the stage at ${viewport.width} by ${viewport.height}`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.setViewportSize(viewport);
      await minimapAlways(page);
      const wanted = await open(page);
      await page.waitForTimeout(600);
      const { stage, parts: found } = await measured(page);
      expect(found.length).toBeGreaterThanOrEqual(wanted);
      expectApart(stage, found);
      const clip = await page
        .getByTestId("slide-stage")
        .evaluate((element) => getComputedStyle(element).overflow);
      expect(["clip", "hidden"]).toContain(clip);
    });
  }
}
