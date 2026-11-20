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
    await page.goto(`/projects/${p07}/slides/${cellsSlide}?task=${rt14}&mode=guided`);
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

const tumor044 = "00000000-0000-4000-8005-000000000005";
const annotateTask = "00000000-0000-4000-8007-000000000021";
const focused = "C3";

const floating = [
  parts,
  '[data-testid="context-bar"]',
  '[data-testid="gpu-wait"]',
  '[data-testid="tile-hint"]',
  '[data-testid="viewer-banner"] > *',
  '[data-testid="stage-coach"] > *',
  '[data-slot="focus-card"]',
  '[data-slot="floating-pill"]',
  '[data-slot="toast"]',
].join(",");

async function floatingParts(page: Page) {
  return page.evaluate(
    ({ selector, object }) => {
      const boxOf = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      const stage = document.querySelector('[data-testid="slide-stage"]');
      const panel = document.querySelector('[data-testid="stage-inspector"]');
      const target = document.querySelector(`[data-testid="ai-object"][data-object="${object}"]`);
      if (stage === null || target === null) throw new Error("no stage or no focused object");
      const found = [...document.querySelectorAll<HTMLElement>(selector)]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 2 && rect.height > 2 && style.visibility !== "hidden";
        })
        .filter(
          (element, _, all) => !all.some((other) => other !== element && other.contains(element)),
        )
        .map((element) => ({
          name: element.dataset["slot"] ?? element.dataset["testid"] ?? element.tagName,
          box: boxOf(element),
        }));
      const map = document.querySelector('[data-testid="stage-minimap"]');
      return {
        stage: boxOf(stage),
        panel: panel === null ? null : boxOf(panel),
        target: boxOf(target),
        corner: map?.getAttribute("data-corner") ?? null,
        parts: found,
      };
    },
    { selector: floating, object: focused },
  );
}

const homeMargin = 12;

const cornerSlack = 8;

function expectInCorner(stage: Box, corner: string | null, map: Box) {
  const [side, edge] = (corner ?? "bottom-right").split("-");
  const across = edge === "left" ? map.x - stage.x : stage.x + stage.width - map.x - map.width;
  const down = side === "top" ? map.y - stage.y : stage.y + stage.height - map.y - map.height;
  for (const gap of [across, down]) {
    expect(gap, `the overview map keeps its margin in the ${corner} corner`).toBeGreaterThan(
      homeMargin - 1,
    );
    expect(gap, `the overview map sits in its ${corner} corner`).toBeLessThan(
      homeMargin + cornerSlack,
    );
  }
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 700 },
]) {
  test(`an annotate task focused with object= keeps floating parts in their zones and the object uncovered at ${viewport.width} by ${viewport.height}`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await page.goto(
      `/projects/${p07}/slides/${tumor044}?task=${annotateTask}&object=${focused}&as=DH`,
    );
    await ready(page);
    await expect(
      page.locator(`[data-testid="ai-object"][data-object="${focused}"]`),
    ).toHaveAttribute("data-selected", "true");
    const stage = await page.getByTestId("slide-stage").boundingBox();
    if (stage === null) throw new Error("no stage");
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
    for (const { wheel, steps, objectInView } of [
      { wheel: 0, steps: 0, objectInView: true },
      { wheel: -500, steps: 4, objectInView: true },
      { wheel: -500, steps: 6, objectInView: false },
      { wheel: 500, steps: 3, objectInView: false },
    ]) {
      for (let step = 0; step < steps; step += 1) {
        await page.mouse.wheel(0, wheel);
        await page.waitForTimeout(80);
      }
      if (steps > 0) await expect(page.getByTestId("stage-minimap")).toBeVisible();
      let before = "";
      await expect
        .poll(async () => {
          const now = JSON.stringify(await floatingParts(page));
          const still = now === before;
          before = now;
          return still;
        })
        .toBe(true);
      const seen = await floatingParts(page);
      expectApart(seen.stage, seen.parts);
      for (const { name, box } of seen.parts) {
        if (objectInView) expect(meets(box, seen.target), `${name} covers ${focused}`).toBe(false);
        if (seen.panel !== null) {
          expect(meets(box, seen.panel), `${name} meets the side panel`).toBe(false);
        }
      }
      const map = seen.parts.find((part) => part.name === "smart-minimap");
      if (map !== undefined) expectInCorner(seen.stage, seen.corner, map.box);
    }
  });
}

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
