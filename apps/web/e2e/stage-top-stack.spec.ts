import { expect, type Locator, type Page, test } from "./a11y.ts";

const annotate = "/projects/p-1/slides/broken-1/live?workspace=annotate&as=DH";

type Box = { x: number; y: number; width: number; height: number };

const meets = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("the element has no box");
  return box;
}

async function failedOpenWithWait(page: Page) {
  await page.goto(annotate);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "failed", { timeout: 30_000 });
  await page.getByRole("button", { name: "Polygon (P)" }).click();
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("parfocal:hold-gpu-wait", { detail: 14 })),
  );
  return stage;
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1024, height: 700 },
]) {
  test(`the context bar, the GPU wait and the failure alert stack without overlap at ${viewport.width} by ${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const stage = await failedOpenWithWait(page);
    const stack = stage.locator('[data-slot="top-stack"]');
    const bar = stack.getByTestId("context-bar");
    const wait = stack.getByTestId("gpu-wait");
    const alert = stack.getByRole("alert");
    await expect(bar).toBeVisible();
    await expect(wait).toBeVisible();
    await expect(alert).toBeVisible();

    const [barBox, waitBox, alertBox, stackBox, stageBox] = await Promise.all([
      boxOf(bar),
      boxOf(wait),
      boxOf(alert),
      boxOf(stack),
      boxOf(stage),
    ]);
    expect(meets(barBox, waitBox)).toBe(false);
    expect(meets(barBox, alertBox)).toBe(false);
    expect(meets(waitBox, alertBox)).toBe(false);
    expect(barBox.y).toBeLessThan(waitBox.y);
    expect(waitBox.y).toBeLessThan(alertBox.y);
    expect(stackBox.x).toBeGreaterThanOrEqual(stageBox.x);
    expect(stackBox.x + stackBox.width).toBeLessThanOrEqual(stageBox.x + stageBox.width);
    await expect(stack).toHaveAttribute("data-minimap-block");

    const others = page.locator(
      '[data-slot="stage-tools"], [data-slot="magnification-bar"], [data-slot="smart-minimap"], [data-testid="travel-minimap"]',
    );
    for (const other of await others.all()) {
      if (!(await other.isVisible())) continue;
      const box = await boxOf(other);
      for (const notice of [barBox, waitBox, alertBox]) expect(meets(notice, box)).toBe(false);
    }
  });
}
