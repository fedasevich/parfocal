import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";
const cellsSlide = "00000000-0000-4000-8005-000000000008";

const floatingParts = [
  '[data-slot="magnification-bar"]',
  '[data-slot="smart-minimap"]',
  '[data-testid="travel-minimap"]',
  '[data-slot="stage-tools"]',
  '[data-testid="cell-type-bar"]',
  '[data-testid="stage-cells-grid"]',
  '[data-slot="cell-cluster"]',
  '[data-testid="whole-slide-button"]',
  '[data-slot="top-stack"] > *',
];

const cameraOf = async (page: Page) =>
  (await page.getByTestId("slide-host").getAttribute("data-camera")) ?? "";

async function settledCamera(page: Page) {
  let last = await cameraOf(page);
  await expect
    .poll(async () => {
      await page.waitForTimeout(200);
      const now = await cameraOf(page);
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
  return last;
}

async function ready(page: Page) {
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
}

async function centreOf(page: Page, selector: string) {
  const part = page.locator(`[data-testid="slide-stage"] ${selector}`).first();
  if ((await part.count()) === 0 || !(await part.isVisible())) return null;
  const box = await part.boundingBox();
  if (box === null) return null;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function pageScale(page: Page) {
  return page.evaluate(() => window.visualViewport?.scale ?? 1);
}

async function wheelOverEveryPart(page: Page) {
  let touched = 0;
  for (const selector of floatingParts) {
    const at = await centreOf(page, selector);
    if (at === null) continue;
    touched += 1;
    await page.mouse.move(at.x, at.y);
    const plainBefore = await settledCamera(page);
    const zoomedIn = Number(plainBefore.split(",")[2]) > 3;
    const out = zoomedIn ? 240 : -240;
    await page.mouse.wheel(0, out);
    await expect
      .poll(() => cameraOf(page), { message: `plain wheel over ${selector}` })
      .not.toBe(plainBefore);
    const ctrlBefore = await settledCamera(page);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -out);
    await page.keyboard.up("Control");
    await expect
      .poll(() => cameraOf(page), { message: `ctrl wheel over ${selector}` })
      .not.toBe(ctrlBefore);
    expect(await pageScale(page), `page zoom after ${selector}`).toBe(1);
  }
  return touched;
}

async function noNativeTitles(page: Page) {
  await page.waitForTimeout(400);
  const left = await page
    .getByTestId("slide-stage")
    .evaluate((stage) =>
      [...stage.querySelectorAll("[title]")].map((node) => node.outerHTML.slice(0, 120)),
    );
  expect(left).toEqual([]);
}

test("a ctrl wheel anywhere in the viewer is never left to the browser", async ({ page }) => {
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}`);
  await ready(page);
  const prevented = await page.evaluate(() => {
    const targets = [
      document.querySelector('[data-slot="magnification-bar"]'),
      document.querySelector('[data-slot="side-panel"]'),
      document.querySelector('[data-testid="slide-stage"]'),
      document.body,
    ];
    return targets.map((target) => {
      if (target === null) return true;
      const event = new WheelEvent("wheel", {
        ctrlKey: true,
        deltaY: -3,
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    });
  });
  expect(prevented).toEqual([true, true, true, true]);
});

test("a wheel and a ctrl wheel over the floating parts of the full viewer move the slide", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/settings/layout");
  await page
    .getByRole("dialog", { name: "Settings" })
    .getByRole("radiogroup", { name: "Minimap" })
    .getByRole("radio", { name: "Always" })
    .click();
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}`);
  await ready(page);
  await page.getByRole("button", { name: "Measure (L)" }).click();
  const touched = await wheelOverEveryPart(page);
  expect(touched).toBeGreaterThanOrEqual(2);
  await noNativeTitles(page);
});

test("a wheel and a ctrl wheel over the cell parts move the slide and the cells grid still scrolls", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(`/projects/${p07}/slides/${cellsSlide}?task=${rt14}`);
  await ready(page);
  await page
    .getByTestId("stage-review-objects")
    .getByRole("button", { name: "Show the cells" })
    .click();
  const grid = page.getByTestId("stage-cells-grid");
  await expect(grid).toBeVisible();
  const scrolls = await grid.evaluate((node) => {
    const own = [node, ...node.querySelectorAll("*")].find(
      (item) =>
        item.scrollHeight > item.clientHeight + 4 &&
        ["auto", "scroll"].includes(getComputedStyle(item).overflowY),
    );
    return own !== undefined;
  });
  if (scrolls) {
    const box = await grid.boundingBox();
    const before = await settledCamera(page);
    await page.mouse.move(
      (box?.x ?? 0) + (box?.width ?? 0) / 2,
      (box?.y ?? 0) + (box?.height ?? 0) / 2,
    );
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(400);
    expect(await settledCamera(page)).toBe(before);
  }
  await page.getByTestId("stage-cells-grid").getByRole("button", { name: /^C2 / }).click();
  await expect(page.getByTestId("cell-type-bar")).toBeVisible();
  const touched = await wheelOverEveryPart(page);
  expect(touched).toBeGreaterThanOrEqual(1);
  await noNativeTitles(page);
});

const stills = [
  { name: "the disagreements viewer", path: `/tasks/${rt14}/disagreements?stage=open` },
  { name: "the adjudicator stage", path: `/tasks/${rt14}/adjudicate?stage=sent` },
  { name: "the guided review", path: `/tasks/${rt14}/guided?slide=${cellsSlide}` },
  { name: "the cells grid screen", path: `/tasks/${rt14}/cells` },
];

for (const { name, path } of stills) {
  test(`a wheel and a ctrl wheel over ${name} move the slide and never the page`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(path);
    const still = page.locator('[data-slot="slide-still"], [data-testid="slide-host"]').first();
    await expect(still).toBeVisible({ timeout: 30_000 });
    const camera = async () => (await still.getAttribute("data-camera")) ?? "";
    await expect.poll(camera).not.toBe("");
    const box = await still.boundingBox();
    if (box === null) throw new Error("no slide");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const before = await camera();
    await page.mouse.wheel(0, -240);
    await expect.poll(camera).not.toBe(before);
    const mid = await camera();
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, 240);
    await page.keyboard.up("Control");
    await expect.poll(camera).not.toBe(mid);
    expect(await pageScale(page)).toBe(1);
    const prevented = await page.evaluate(() => {
      const event = new WheelEvent("wheel", {
        ctrlKey: true,
        deltaY: -3,
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(true);
  });
}
