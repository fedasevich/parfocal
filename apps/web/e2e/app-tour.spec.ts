import { expect, type Page, test } from "@playwright/test";

const chapterTitles = [
  "Upload and import",
  "Review as reviewer A",
  "Projects and their settings",
  "The viewer and its tabs",
  "Annotate as an expert",
  "Create a review task",
  "Review as reviewer B and as a viewer",
  "The queue and adjudication",
  "Sign off, evaluation and dataset",
  "Cases and reports",
  "Jobs and model runs",
  "Search",
  "Notifications and comments",
  "Team and settings",
  "Admin",
  "The participant study",
];

const fakeDataFallbacks = [
  "#annotate-task-panel|#live-top-bar",
  "#start-run|",
  "#mark-slide-checked|",
  "decision-buttons|main",
  "queue-send|",
  "main|[data-slot=",
  "#dataset-",
  "#sign-off-undecided|",
  "#co-sign|main",
  "#study-",
  "#slides-table",
  '[data-slot="jobs-button"]|',
];

type Rect = { x: number; y: number; width: number; height: number };

const shownBox = (page: Page, selector: string) =>
  page.evaluate((query) => {
    for (const one of query.split("\n")) {
      for (const element of document.querySelectorAll(one)) {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
        }
      }
    }
    return null;
  }, selector);

const covers = (outer: Rect, inner: Rect) =>
  outer.x <= inner.x + 0.5 &&
  outer.y <= inner.y + 0.5 &&
  outer.x + outer.width >= inner.x + inner.width - 0.5 &&
  outer.y + outer.height >= inner.y + inner.height - 0.5;

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function playChapter(page: Page, title: string, reloadAt: number | null) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Tour of the app" }).click();
  const menu = page.getByRole("dialog", { name: "Tour of the app" });
  await menu.getByRole("button", { name: `Play ${title}`, exact: true }).click();
  const bubble = page.getByTestId("tour-bubble");
  const ring = page.getByTestId("tour-ring");
  const seen: string[] = [];
  for (let count = 0; count < 40; count += 1) {
    await expect(bubble).toBeVisible({ timeout: 20_000 });
    const number = Number(await bubble.getAttribute("data-step"));
    const switchButton = bubble.getByTestId("tour-switch");
    if (await switchButton.isVisible()) {
      const loaded = page.waitForEvent("load", { timeout: 30_000 });
      await switchButton.click();
      await loaded;
      await expect(bubble).toHaveAttribute("data-step", String(number), { timeout: 20_000 });
      await expect(switchButton).toBeHidden({ timeout: 20_000 });
    }
    const anchorName = (await bubble.getAttribute("data-anchor")) ?? "";
    const selector = (await bubble.getAttribute("data-selector")) ?? "";
    const advance = await bubble.getAttribute("data-advance");
    const label = `step ${number} ${anchorName} on ${page.url()}`;
    seen.push(anchorName);
    await expect(bubble).toContainText("You are ");
    await expect(ring, `${label} rings nothing`).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        async () => {
          const anchor = await shownBox(page, selector);
          const ringBox = await ring.boundingBox();
          return anchor !== null && ringBox !== null && covers(ringBox, anchor);
        },
        { message: `${label} ring does not cover the anchor` },
      )
      .toBe(true);
    const anchor = await shownBox(page, selector);
    const bubbleBox = await bubble.boundingBox();
    expect(anchor && anchor.width > 0 && anchor.height > 0, label).toBe(true);
    if (anchor && bubbleBox && anchor.width * anchor.height < 1440 * 900 * 0.4) {
      expect(overlaps(anchor, bubbleBox), `${label} bubble covers the anchor`).toBe(false);
    }
    await expect(bubble.getByTestId("tour-anchor-missing")).toHaveCount(0);
    expect(["exact", "fallback"], `${label} route`).toContain(
      await bubble.getAttribute("data-route"),
    );
    if (!fakeDataFallbacks.some((prefix) => anchorName.startsWith(prefix))) {
      expect(await bubble.getAttribute("data-match"), `${label} ringed a fallback`).toBe("0");
    }
    if ((await bubble.getAttribute("data-gpu")) === "yes") {
      await expect(bubble.getByTestId("tour-gpu-note")).toBeVisible();
    }
    if (reloadAt === count) {
      await page.reload();
      await expect(bubble).toHaveAttribute("data-step", String(number), { timeout: 20_000 });
      await expect(ring).toBeVisible({ timeout: 20_000 });
    }
    if (advance === "next") {
      await bubble.getByTestId("tour-next").click();
    } else {
      await page.locator(selector.split("\n").join(",")).locator("visible=true").first().click();
    }
    const gone = await bubble
      .waitFor({ state: "hidden", timeout: 1500 })
      .then(() => true)
      .catch(() => false);
    if (gone) return seen;
  }
  throw new Error(`the chapter ${title} did not end`);
}

test("the tour menu lists every chapter", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Tour of the app" }).click();
  const menu = page.getByRole("dialog", { name: "Tour of the app" });
  for (const [index, title] of chapterTitles.entries()) {
    await expect(menu).toContainText(`${index + 1} · ${title}`);
  }
  await expect(menu.getByRole("button", { name: /^Play (?!all)/ })).toHaveCount(
    chapterTitles.length,
  );
});

for (const [index, title] of chapterTitles.entries()) {
  test(`chapter ${index + 1} plays on the app, ringing every control: ${title}`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const seen = await playChapter(page, title, index === 0 ? 2 : null);
    expect(seen.length).toBeGreaterThan(2);
  });
}

test("a missing control says so and offers Next instead of hanging", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "parfocal.app-tour",
      JSON.stringify({ index: 4, playAll: false, acting: "researcher" }),
    );
  });
  await page.addInitScript(() => {
    new MutationObserver(() => {
      for (const element of document.querySelectorAll('[data-tour="project-upload"]')) {
        element.removeAttribute("data-tour");
      }
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
  await page.goto("/");
  const bubble = page.getByTestId("tour-bubble");
  await expect(bubble).toHaveAttribute("data-step", "5");
  await expect(bubble.getByTestId("tour-anchor-missing")).toBeVisible({ timeout: 15_000 });
  await bubble.getByRole("button", { name: "Next" }).click();
  await expect(bubble).toHaveAttribute("data-step", "6");
});
