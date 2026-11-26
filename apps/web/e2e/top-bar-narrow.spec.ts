import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const a1 = "00000000-0000-4000-8005-000000000001";
const rt14 = "00000000-0000-4000-8007-000000000014";
const annotateTask = "00000000-0000-4000-8007-000000000021";

const widths = [640, 768] as const;

const withResults = "00000000-0000-4000-8005-000000000005";

const routes = [
  { name: "a plain slide", path: `/projects/${p07}/slides/${a1}?as=DH`, minWidth: 0 },
  {
    name: "a review task",
    path: `/projects/${p07}/slides/${a1}?task=${rt14}&mode=review&as=DH`,
    minWidth: 768,
  },
  {
    name: "an annotate task",
    path: `/projects/${p07}/slides/${withResults}?task=${annotateTask}&tab=objects&as=DH`,
    minWidth: 768,
  },
] as const;

async function covered(page: Page) {
  return page.getByTestId("live-top-bar").evaluate((bar: HTMLElement) => {
    const controls = [
      ...bar.querySelectorAll<HTMLElement>(
        'a[href], button, [role="radio"], [data-testid="slide-picker"]',
      ),
    ].filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    return controls
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const x = Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1);
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        return hit === null || !(element === hit || element.contains(hit) || hit.contains(element));
      })
      .map((element) => element.outerHTML.slice(0, 90));
  });
}

async function overlapping(page: Page) {
  return page.getByTestId("live-top-bar").evaluate((bar: HTMLElement) => {
    const picker = bar.querySelector<HTMLElement>('[data-testid="slide-picker"]');
    if (!picker) return ["no picker"];
    const frame = picker.getBoundingClientRect();
    const others = [
      ...bar.querySelectorAll<HTMLElement>(
        '[data-testid="slide-progress"], [data-testid="mode-switch"], [data-testid="viewer-back"]',
      ),
    ];
    return others
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.left < frame.right - 0.5 &&
          rect.right > frame.left + 0.5 &&
          rect.top < frame.bottom &&
          rect.bottom > frame.top
        );
      })
      .map((element) => element.getAttribute("data-testid") ?? "");
  });
}

for (const width of widths) {
  for (const route of routes.filter((entry) => entry.minWidth <= width)) {
    test(`the slide switcher opens and every top bar control stays clickable at ${width} px on ${route.name}`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 800 });
      await page.goto(route.path);
      await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
        timeout: 20_000,
      });
      const bar = page.getByTestId("live-top-bar");
      const picker = bar.getByTestId("slide-picker");
      await expect(picker).toBeVisible();

      if (route.name === "a plain slide") {
        await expect(bar.getByTestId("viewed-ring")).toBeVisible({ timeout: 15_000 });
      }
      expect(await overlapping(page)).toEqual([]);
      expect(await covered(page)).toEqual([]);

      const scroll = await bar.evaluate((node: HTMLElement) => node.scrollWidth - node.clientWidth);
      expect(scroll).toBeLessThanOrEqual(1);

      const box = await picker.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThan(90);

      await picker.click();
      const popover = page.getByRole("dialog", { name: "Slides in this case and task" });
      await expect(popover).toBeVisible();
      const frame = await popover.boundingBox();
      expect(frame?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((frame?.x ?? 0) + (frame?.width ?? 0)).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      await expect(popover).toBeHidden();

      await expect(bar.getByTestId("slide-progress")).toBeVisible();
      await expect(bar.getByTestId("slide-progress")).toContainText(/Slide \d+ of \d+/);
    });
  }
}
