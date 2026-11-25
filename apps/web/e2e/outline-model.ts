import { expect, type Page } from "@playwright/test";

export const outlineModel = (page: Page) => page.getByTestId("model-tier");

export async function pickOutlineModel(page: Page, name: "Best" | "Good") {
  const picker = outlineModel(page);
  await picker.click();
  await page.getByRole("option", { name: new RegExp(`^${name}`) }).click();
  await expect(picker).toHaveAttribute("data-tier", name.toLowerCase());
  await expect(picker).toHaveText(name);
}

type BarWatch = { rows: number; height: number; samples: number; seen: number; worst: string };

type BarGlobals = {
  countBarRows: (bar: Element) => number;
  barWatch: BarWatch & { running: boolean; seenSelector: string };
};

const installBarCounter = () => {
  const globals = window as unknown as BarGlobals;
  globals.countBarRows = (bar) => {
    const items = Array.from(
      bar.querySelectorAll(
        ":scope > *:not([data-slot=context-extras]), [data-slot=context-extras] > *",
      ),
    );
    const centres = items
      .map((item) => item.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => rect.top + rect.height / 2)
      .sort((a, b) => a - b);
    let rows = centres.length === 0 ? 0 : 1;
    for (let index = 1; index < centres.length; index += 1) {
      if ((centres[index] ?? 0) - (centres[index - 1] ?? 0) > 8) rows += 1;
    }
    return rows;
  };
};

export async function barRows(page: Page): Promise<number> {
  await page.evaluate(installBarCounter);
  return page
    .getByTestId("context-bar")
    .evaluate((bar) => (window as unknown as BarGlobals).countBarRows(bar));
}

export async function barHeight(page: Page): Promise<number> {
  const box = await page.getByTestId("context-bar").boundingBox();
  return box?.height ?? 0;
}

export async function startBarWatch(page: Page, seenTestId: string): Promise<void> {
  await page.evaluate(installBarCounter);
  await page.evaluate((seenId) => {
    const globals = window as unknown as BarGlobals;
    const watch = {
      rows: 0,
      height: 0,
      samples: 0,
      seen: 0,
      worst: "",
      running: true,
      seenSelector: seenId,
    };
    globals.barWatch = watch;
    const sample = () => {
      const bar = document.querySelector('[data-testid="context-bar"]');
      if (bar !== null) {
        watch.samples += 1;
        const rows = globals.countBarRows(bar);
        if (rows > watch.rows) watch.worst = (bar.textContent ?? "").slice(0, 200);
        watch.rows = Math.max(watch.rows, rows);
        watch.height = Math.max(watch.height, bar.getBoundingClientRect().height);
        if (bar.querySelector(`[data-testid="${watch.seenSelector}"]`) !== null) watch.seen += 1;
      }
      if (watch.running) requestAnimationFrame(sample);
    };
    sample();
  }, seenTestId);
}

export async function stopBarWatch(page: Page): Promise<BarWatch> {
  return page.evaluate(() => {
    const watch = (window as unknown as BarGlobals).barWatch;
    watch.running = false;
    return {
      rows: watch.rows,
      height: watch.height,
      samples: watch.samples,
      seen: watch.seen,
      worst: watch.worst,
    };
  });
}
