import { expect, type Locator, type Page } from "@playwright/test";

export const pdfViewer = (page: Page) => page.getByRole("dialog", { name: "PDF preview" });
export const readingPage = (page: Page) => pdfViewer(page).getByLabel("Current page");

export async function stubPrint(page: Page) {
  await page.evaluate(() => {
    const seen: { pages: number; widths: string[]; style: string }[] = [];
    Object.assign(window, { printed: seen });
    window.print = () => {
      const sheet = document.querySelector("[data-print-sheet]");
      seen.push({
        pages: sheet?.querySelectorAll("img").length ?? 0,
        widths: Array.from(sheet?.querySelectorAll("img") ?? [], (image) =>
          String(image.naturalWidth),
        ),
        style: sheet?.querySelector("style")?.textContent ?? "",
      });
    };
  });
}

export async function printed(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { printed: { pages: number; widths: string[]; style: string }[] })
        .printed,
  );
}

export async function pageSvg(image: Locator) {
  const source = (await image.getAttribute("src")) ?? "";
  return decodeURIComponent(source.replace(/^data:image\/svg\+xml;charset=utf-8,/, ""));
}

export async function expectReadablePage(page: Page, image: Locator) {
  await expect(image).toBeVisible();
  const drawn = await image.evaluate((node) => {
    const element = node as HTMLImageElement;
    return {
      natural: element.naturalWidth,
      shown: element.getBoundingClientRect().width,
      complete: element.complete,
    };
  });
  expect(drawn.complete).toBe(true);
  expect(drawn.natural).toBeGreaterThan(500);
  expect(drawn.shown).toBeGreaterThanOrEqual(Math.min(drawn.natural, 794) - 1);
  const frame = await pdfViewer(page)
    .getByRole("region", { name: "Pages of the report" })
    .boundingBox();
  expect(drawn.shown).toBeLessThanOrEqual((frame?.width ?? 0) + 1);
}

export async function stepAndZoom(page: Page, count: number) {
  const preview = pdfViewer(page);
  await expect(readingPage(page)).toHaveText(`1 / ${count}`);
  if (count > 1) {
    await preview.getByRole("button", { name: `Page ${count}`, exact: true }).click();
    await expect(readingPage(page)).toHaveText(`${count} / ${count}`);
    await preview.getByRole("button", { name: "Page 1", exact: true }).click();
    await expect(readingPage(page)).toHaveText(`1 / ${count}`);
  }
  const first = preview.getByRole("img", { name: "Page 1 of the report" });
  const zoom = preview.getByRole("status", { name: "Zoom", exact: true });
  const fitted = Number((await zoom.textContent())?.replace("%", ""));
  const fittedWidth = (await first.boundingBox())?.width ?? 0;
  await preview.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoom).not.toHaveText(`${fitted}%`);
  expect((await first.boundingBox())?.width ?? 0).toBeGreaterThan(fittedWidth);
  await preview.getByRole("button", { name: "Fit the page to the width" }).click();
  await expect(zoom).toHaveText(`${fitted}%`);
}
