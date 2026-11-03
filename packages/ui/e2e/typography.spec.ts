import { fontFamilies, typeScale, typeStyles } from "@parfocal/tokens";
import { expect, type Page, test } from "@playwright/test";

const story = (theme: string) =>
  `/iframe.html?id=components-foundations--type-scale&viewMode=story&globals=a11y.manual:!true;theme:${theme}`;

interface Shown {
  size: string;
  line: string;
  weight: string;
  family: string;
  transform: string;
  width: number;
  fallbackWidth: number;
}

const rendered = (page: Page) =>
  page.evaluate(() => {
    const widthIn = (node: HTMLElement, family: string) => {
      const probe = node.cloneNode(true) as HTMLElement;
      probe.style.fontFamily = family;
      probe.style.position = "absolute";
      probe.style.width = "auto";
      node.after(probe);
      const width = probe.getBoundingClientRect().width;
      probe.remove();
      return width;
    };
    const read = (node: HTMLElement): Shown => {
      const style = getComputedStyle(node);
      return {
        size: style.fontSize,
        line: style.lineHeight,
        weight: style.fontWeight,
        family: style.fontFamily,
        transform: style.textTransform,
        width: widthIn(node, style.fontFamily),
        fallbackWidth: widthIn(node, "sans-serif"),
      };
    };
    const styles: Record<string, Shown> = Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>("[data-type-style]")].map(
        (node): [string, Shown] => [node.dataset.typeStyle ?? "", read(node)],
      ),
    );
    const mono = [...document.querySelectorAll<HTMLElement>("[data-testid=type-mono] .font-mono")];
    return { styles, mono: mono.map(read) };
  });

const settle = async (page: Page, theme: string) => {
  await page.goto(story(theme));
  await page.locator("[data-testid=type-scale]").waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.reload();
  await page.locator("[data-testid=type-scale]").waitFor();
  await page.evaluate(() => document.fonts.ready);
};

for (const theme of ["dark", "light"] as const) {
  test(`the type specimen shows nine sizes in Plex in ${theme}`, async ({ page }) => {
    await settle(page, theme);
    const { styles, mono } = await rendered(page);
    expect(Object.keys(styles)).toEqual([...typeStyles]);
    for (const style of typeStyles) {
      const spec = typeScale[style];
      const shown = styles[style];
      expect(shown?.size, style).toBe(`${spec.size}px`);
      expect(shown?.line, style).toBe(`${spec.line}px`);
      expect(shown?.weight, style).toBe(String(spec.weight));
      expect(shown?.family.startsWith(`"${fontFamilies.ui}"`), style).toBe(true);
      expect(shown?.width, style).not.toBe(shown?.fallbackWidth);
    }
    expect(styles.label?.transform).toBe("uppercase");
    expect(mono).toHaveLength(4);
    for (const shown of mono) {
      expect(shown.family.startsWith(`"${fontFamilies.data}"`)).toBe(true);
      expect(shown.width).not.toBe(shown.fallbackWidth);
    }
  });
}

test("fonts come from our own origin and load in both weights", async ({ page }) => {
  const fontHosts = new Set<string>();
  page.on("request", (request) => {
    if (request.resourceType() === "font") fontHosts.add(new URL(request.url()).host);
  });
  await settle(page, "dark");
  expect([...fontHosts]).toEqual([new URL(page.url()).host]);
  const loaded = await page.evaluate(() =>
    [...document.fonts]
      .filter((face) => face.status === "loaded")
      .map((face) => `${face.family.replaceAll('"', "")} ${face.weight}`),
  );
  for (const face of [
    `${fontFamilies.ui} 400`,
    `${fontFamilies.ui} 600`,
    `${fontFamilies.data} 400`,
  ]) {
    expect(loaded).toContain(face);
  }
});

test("a slow font never moves the text", async ({ page }) => {
  await page.route("**/*.woff2", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.addInitScript(() => {
    const shifts: number[] = [];
    Object.assign(window, { shifts });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        shifts.push((entry as unknown as { value: number }).value);
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto(story("dark"));
  const scale = page.locator("[data-testid=type-scale]");
  await scale.waitFor();
  const before = await scale.boundingBox();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const after = await scale.boundingBox();
  expect(after).toEqual(before);
  const shifts = await page.evaluate(() => (window as unknown as { shifts: number[] }).shifts);
  expect(shifts.reduce((sum, value) => sum + value, 0)).toBe(0);
});
