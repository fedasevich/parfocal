import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const a1 = "00000000-0000-4000-8005-000000000001";
const rt14 = "00000000-0000-4000-8007-000000000014";
const annotateTask = "00000000-0000-4000-8007-000000000021";
const withResults = "00000000-0000-4000-8005-000000000005";

const sizes = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 700 },
] as const;

const annotateUrl = `/projects/${p07}/slides/${withResults}?task=${annotateTask}&tab=objects&as=DH`;

const routes = [
  ["the full viewer", `/projects/${p07}/slides/${a1}?task=${rt14}`],
  ["guided review", `/projects/${p07}/slides/${a1}?task=${rt14}&mode=guided`],
  ["the annotate task viewer", annotateUrl],
] as const;

const toolKeys = ["v", "h", "s", "p", "Shift+P", "r", "o", "m", "l", "Shift+L", "t", "c", "b"];

test.setTimeout(120_000);

async function ready(page: Page) {
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  return stage;
}

async function zoomIn(page: Page) {
  const stage = await ready(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let step = 0; step < 30; step += 1) {
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(15);
  }
}

const overflowOf = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    return {
      vertical: root.scrollHeight - root.clientHeight,
      horizontal: root.scrollWidth - root.clientWidth,
      body: document.body.scrollHeight - document.body.clientHeight,
    };
  });

for (const size of sizes) {
  test.describe(`${size.width} by ${size.height}`, () => {
    test.use({ viewport: size });

    for (const [name, url] of routes) {
      test(`the document does not scroll in ${name}`, async ({ page }) => {
        await page.goto(url);
        await zoomIn(page);
        await page.waitForTimeout(300);
        const overflow = await overflowOf(page);
        expect(overflow.vertical).toBeLessThanOrEqual(0);
        expect(overflow.horizontal).toBeLessThanOrEqual(0);
        expect(overflow.body).toBeLessThanOrEqual(0);
      });
    }

    test("every chip and key in the slides popover sits inside its box", async ({ page }) => {
      await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&as=DH`);
      await ready(page);
      await page.getByTestId("live-top-bar").getByTestId("slide-picker").click();
      const popover = page.getByRole("dialog", { name: "Slides in this case and task" });
      await expect(popover).toBeVisible();
      await page.waitForTimeout(600);
      const edge = (await popover.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
      expect(edge.x).toBeGreaterThanOrEqual(0);
      expect(edge.x + edge.width).toBeLessThanOrEqual(size.width);
      const parts = popover.locator('kbd, [data-slot="status-tag"], [data-slot="slide-row"]');
      const count = await parts.count();
      expect(count).toBeGreaterThan(3);
      for (let index = 0; index < count; index += 1) {
        const part = await parts.nth(index).boundingBox();
        if (part === null) continue;
        expect(part.x).toBeGreaterThanOrEqual(edge.x - 0.5);
        expect(part.x + part.width).toBeLessThanOrEqual(edge.x + edge.width + 0.5);
      }
      const clipped = await popover.evaluate(
        (node) =>
          [...node.querySelectorAll<HTMLElement>('kbd, [data-slot="status-tag"]')].filter(
            (item) => item.scrollWidth > item.clientWidth,
          ).length,
      );
      expect(clipped).toBe(0);
    });

    test("no hint chip is clipped for any tool", async ({ page }) => {
      await page.goto(annotateUrl);
      await ready(page);
      let seen = 0;
      for (const key of toolKeys) {
        await page.keyboard.press(key);
        const bar = page.locator(`[data-slot="context-bar"]`);
        if ((await bar.count()) === 0) continue;
        const count = await bar.locator('[data-slot="context-pill"]').count();
        const clipped = await bar.evaluate((node) => {
          const barBox = node.getBoundingClientRect();
          return [...node.querySelectorAll<HTMLElement>('[data-slot="context-pill"]')].filter(
            (pill) => {
              const box = pill.getBoundingClientRect();
              return (
                pill.scrollWidth > pill.clientWidth ||
                box.right > barBox.right + 0.5 ||
                box.left < barBox.left - 0.5
              );
            },
          ).length;
        });
        expect(clipped, `tool key ${key}`).toBe(0);
        seen += count;
      }
      expect(seen).toBeGreaterThan(5);
    });
  });
}
