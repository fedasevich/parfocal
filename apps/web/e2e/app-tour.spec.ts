import { expect, type Page, test } from "@playwright/test";

const tourSteps = [
  ["top-upload", "click"],
  ["upload-source", "next"],
  ["upload-drop", "next"],
  ["upload-formats", "next"],
  ["project-upload", "next"],
  ["project-new-task", "next"],
  ["my-work-tabs", "next"],
  ["my-work-task", "click"],
  ["preview-main", "click"],
  ["decision-buttons", "next"],
  ["mode-switch", "next"],
  ["my-work-tabs", "next"],
].map(([anchor = "", advance = ""], index) => ({ anchor, advance, number: index + 1 }));

type Rect = { x: number; y: number; width: number; height: number };

const shownBox = (page: Page, anchor: string) =>
  page.evaluate((name) => {
    for (const element of document.querySelectorAll(`[data-tour="${name}"]`)) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
      }
    }
    return null;
  }, anchor);

const covers = (outer: Rect, inner: Rect) =>
  outer.x <= inner.x + 0.5 &&
  outer.y <= inner.y + 0.5 &&
  outer.x + outer.width >= inner.x + inner.width - 0.5 &&
  outer.y + outer.height >= inner.y + inner.height - 0.5;

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test("the tour plays upload and review over the app, ringing every control", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Tour of the app" }).click();
  const menu = page.getByRole("dialog", { name: "Tour of the app" });
  await expect(menu).toContainText("Upload and import");
  await expect(menu).toContainText("Review as reviewer A");
  await menu.getByRole("button", { name: "Play all" }).click();

  const bubble = page.getByTestId("tour-bubble");
  const ring = page.getByTestId("tour-ring");
  for (const step of tourSteps) {
    await expect(bubble).toHaveAttribute("data-step", String(step.number), { timeout: 20_000 });
    const switchButton = bubble.getByRole("button", { name: /^Switch to the / });
    if (await switchButton.isVisible()) {
      await switchButton.click();
      await expect(bubble).toHaveAttribute("data-step", String(step.number), { timeout: 20_000 });
    }
    await expect(bubble).toContainText(`Step ${step.number} of ${tourSteps.length}`);
    await expect(bubble).toContainText("You are ");
    await expect(ring, `step ${step.number} rings ${step.anchor} on ${page.url()}`).toBeVisible({
      timeout: 60_000,
    });
    await expect
      .poll(async () => {
        const anchor = await shownBox(page, step.anchor);
        const ringBox = await ring.boundingBox();
        return anchor !== null && ringBox !== null && covers(ringBox, anchor);
      })
      .toBe(true);
    const anchor = await shownBox(page, step.anchor);
    const bubbleBox = await bubble.boundingBox();
    expect(anchor && anchor.width > 0 && anchor.height > 0).toBe(true);
    if (anchor && bubbleBox) expect(overlaps(anchor, bubbleBox)).toBe(false);
    await expect(bubble.getByTestId("tour-anchor-missing")).toHaveCount(0);
    if (step.number === 3) {
      await page.reload();
      await expect(bubble).toHaveAttribute("data-step", "3", { timeout: 20_000 });
      await expect(ring).toBeVisible({ timeout: 20_000 });
    }
    if (step.advance === "next") {
      await bubble.getByRole("button", { name: /^(Next|Done)$/ }).click();
    } else {
      await page.locator(`[data-tour="${step.anchor}"]:visible`).first().click();
    }
  }
  await expect(bubble).toBeHidden({ timeout: 20_000 });
});

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
