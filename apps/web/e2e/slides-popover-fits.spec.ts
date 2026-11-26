import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const longName =
  "Sentinel lymph node level II left axilla haematoxylin and eosin recut three of six scanned 2025";

const sizes = [
  { name: "narrow", width: 1024, height: 700 },
  { name: "wide", width: 1440, height: 900 },
] as const;

async function openLongNamedSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides&as=DH`);
  await page.getByRole("button", { name: "Edit slides" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Edit slides" });
  await dialog.getByLabel("Label of slide 1").fill(longName);
  await dialog.getByRole("button", { name: "Save slides" }).click();
  await expect(dialog).toBeHidden();
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "S26-04812_A1_HE.svs" })
    .getByTestId("slide-link")
    .click();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
}

for (const size of sizes) {
  test(`every row control and footer button sits inside the slides popover at the ${size.name} size`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: size.width, height: size.height });
    await openLongNamedSlide(page);
    await page.getByTestId("live-top-bar").getByTestId("slide-picker").click();
    const popover = page.getByRole("dialog", { name: "Slides in this case and task" });
    await expect(popover).toBeVisible();
    await popover.evaluate((node: HTMLElement) =>
      Promise.all(
        [node, ...(node.parentElement ? [node.parentElement] : [])].flatMap((target) =>
          target.getAnimations({ subtree: true }).map((animation) => animation.finished),
        ),
      ),
    );
    const box = await popover.boundingBox();
    if (!box) throw new Error("the popover has no box");
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);

    const outside = await popover.evaluate((node: HTMLElement) => {
      const frame = node.getBoundingClientRect();
      const inside = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return rect.left >= frame.left - 0.5 && rect.right <= frame.right + 0.5;
      };
      const controls = [
        ...node.querySelectorAll(
          '[data-slot="slide-row"], [data-slot="slide-row"] > *, button, [data-slot="status-tag"]',
        ),
      ];
      return controls
        .filter((element) => !inside(element))
        .map((element) => element.outerHTML.slice(0, 80));
    });
    expect(outside).toEqual([]);

    const current = popover.locator('[data-slot="slide-row"][data-current="true"]');
    await expect(current).toBeVisible();
    await expect(current).toContainText("Open");
    await expect(current.getByTitle(/result sets?$/)).toBeVisible();
    await expect(current.locator("b")).toHaveAttribute("title", `${longName} · H&E`);

    for (const name of [`Result sets of ${longName}`, "Compare", "Add slides"]) {
      const button = popover.getByRole("button", { name, exact: name === "Compare" });
      await expect(button).toBeVisible();
      const rect = await button.boundingBox();
      if (!rect) throw new Error(`no box for ${name}`);
      expect(rect.x).toBeGreaterThanOrEqual(box.x - 0.5);
      expect(rect.x + rect.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
    }
  });
}
